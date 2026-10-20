// title-cards-render: makes one title card MP4 with parts that come with macOS.
//
//   title-cards-render --page /path/card/card.html --root /path/to/tool \
//                      --query "title=Home&theme=dark" --out card.mp4 --fps 30
//
// How it works:
// 1. WebKit (the engine inside Safari) opens card.html in an invisible window.
// 2. For every frame, we move the paused GSAP timeline to that exact time
//    and take a snapshot. Nothing plays in real time.
// 3. We turn each snapshot into video colors ourselves, with a small dither
//    so the soft glow does not turn into rings ("banding").
// 4. AVFoundation (Apple's video library) writes the H.264 MP4.
//
// It prints "frame 12/135" lines while it works. On an error it prints the
// reason and exits with code 1.
//
// Build: npm run build:helper (see scripts/build-helper.sh).

import AVFoundation
import Cocoa
import CoreVideo
import WebKit

let WIDTH = 1920
let HEIGHT = 1080

struct Options {
    var page = ""
    var root = ""
    var query = ""
    var out = ""
    var fps: Int32 = 30
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(("title-cards-render: " + message + "\n").data(using: .utf8)!)
    exit(1)
}

func parseOptions() -> Options {
    var o = Options()
    var args = CommandLine.arguments.dropFirst()
    while let key = args.popFirst() {
        guard let value = args.popFirst() else { fail("missing value for \(key)") }
        switch key {
        case "--page": o.page = value
        case "--root": o.root = value
        case "--query": o.query = value
        case "--out": o.out = value
        case "--fps": o.fps = Int32(value) ?? 30
        default: fail("unknown option \(key)")
        }
    }
    if o.page.isEmpty || o.out.isEmpty { fail("--page and --out are needed") }
    if o.root.isEmpty { o.root = URL(fileURLWithPath: o.page).deletingLastPathComponent().path }
    if o.fps != 30 && o.fps != 60 { fail("--fps must be 30 or 60") }
    return o
}

// ---- Color conversion: sRGB (BGRA) to video YUV (NV12, BT.709, TV range) ----

// An 8x8 Bayer pattern, scaled to -0.5...0.5. Adding it before rounding
// spreads the rounding error into a fine, even texture instead of rings.
let bayer: [Float] = {
    var m = [[0]]
    while m.count < 8 {
        let n = m.count
        var r = [[Int]](repeating: [Int](repeating: 0, count: n * 2), count: n * 2)
        for y in 0..<n {
            for x in 0..<n {
                let v = m[y][x] * 4
                r[y][x] = v; r[y][x + n] = v + 2; r[y + n][x] = v + 3; r[y + n][x + n] = v + 1
            }
        }
        m = r
    }
    return m.flatMap { $0 }.map { (Float($0) + 0.5) / 64.0 - 0.5 }
}()

func convertToNV12(_ src: UnsafePointer<UInt8>, stride: Int, into buf: CVPixelBuffer) {
    let yPlane = CVPixelBufferGetBaseAddressOfPlane(buf, 0)!.assumingMemoryBound(to: UInt8.self)
    let yStride = CVPixelBufferGetBytesPerRowOfPlane(buf, 0)
    let cPlane = CVPixelBufferGetBaseAddressOfPlane(buf, 1)!.assumingMemoryBound(to: UInt8.self)
    let cStride = CVPixelBufferGetBytesPerRowOfPlane(buf, 1)
    @inline(__always) func clamp(_ v: Float, _ lo: Float, _ hi: Float) -> UInt8 {
        UInt8(max(lo, min(hi, v.rounded(.down))))
    }
    // Brightness (Y), one value per pixel.
    for y in 0..<HEIGHT {
        for x in 0..<WIDTH {
            let p = src + y * stride + x * 4
            let b = Float(p[0]), g = Float(p[1]), r = Float(p[2])
            let luma = 16 + (0.2126 * r + 0.7152 * g + 0.0722 * b) * (219.0 / 255.0)
            yPlane[y * yStride + x] = clamp(luma + 0.5 + bayer[(y & 7) * 8 + (x & 7)], 16, 235)
        }
    }
    // Color (Cb, Cr), one pair for each 2x2 block of pixels.
    for y in 0..<(HEIGHT / 2) {
        for x in 0..<(WIDTH / 2) {
            var r: Float = 0, g: Float = 0, b: Float = 0
            for dy in 0..<2 {
                for dx in 0..<2 {
                    let p = src + (2 * y + dy) * stride + (2 * x + dx) * 4
                    b += Float(p[0]); g += Float(p[1]); r += Float(p[2])
                }
            }
            r /= 4; g /= 4; b /= 4
            let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            let cb = 128 + (b - luma) / 1.8556 * (224.0 / 255.0)
            let cr = 128 + (r - luma) / 1.5748 * (224.0 / 255.0)
            let d = bayer[((y + 3) & 7) * 8 + ((x + 5) & 7)]
            cPlane[y * cStride + 2 * x] = clamp(cb + 0.5 + d, 16, 240)
            cPlane[y * cStride + 2 * x + 1] = clamp(cr + 0.5 - d, 16, 240)
        }
    }
}

// ---- Stop instead of hanging ----

// WebKit pauses pages it thinks nobody can see (for example when the screen is
// locked). Then a frame never finishes. This stops the helper with a clear message.
var lastProgress = Date()
func startWatchdog() {
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        if Date().timeIntervalSince(lastProgress) > 30 {
            fail("rendering stopped responding. Is the screen locked or the Mac asleep? Unlock it and try again.")
        }
    }
}

// ---- Main work ----

@MainActor
func run(_ o: Options) async throws {
    NSApplication.shared.setActivationPolicy(.accessory) // no Dock icon, no menu bar

    // The page always lays out at 1920x1080 CSS pixels. The window is half that
    // size in points with the page zoomed to 50%, so it fits on any screen. On a
    // Retina screen (2 pixels per point) one CSS pixel is then exactly one pixel.
    let screen = NSScreen.screens.max(by: { $0.backingScaleFactor < $1.backingScaleFactor }) ?? NSScreen.main
    guard let screen else { fail("no screen found. The helper needs a logged-in Mac with a screen.") }
    let viewSize = NSSize(width: WIDTH / 2, height: HEIGHT / 2)
    let config = WKWebViewConfiguration()
    let webView = WKWebView(frame: NSRect(origin: .zero, size: viewSize), configuration: config)
    webView.pageZoom = 0.5

    // An invisible window (fully transparent, clicks go through it) that floats
    // above other windows on every desktop. WebKit only draws pages that are
    // in a window on screen, so it must not be hidden behind other windows.
    let window = NSWindow(
        contentRect: NSRect(origin: screen.visibleFrame.origin, size: viewSize),
        styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
    window.contentView = webView
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    window.orderFrontRegardless()

    // Load the card. The query is already percent-encoded by the caller.
    let pageURL = URL(fileURLWithPath: o.page)
    var comps = URLComponents(url: pageURL, resolvingAgainstBaseURL: false)!
    comps.percentEncodedQuery = o.query
    webView.loadFileURL(comps.url!, allowingReadAccessTo: URL(fileURLWithPath: o.root, isDirectory: true))

    var ready = false
    for _ in 0..<150 {
        if (try? await webView.callAsyncJavaScript("return window.__cardReady === true", contentWorld: .page)) as? Bool == true {
            ready = true
            break
        }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    if !ready { fail("the card page did not load (\(o.page))") }
    lastProgress = Date()

    let duration = try await webView.callAsyncJavaScript("return window.__card.duration", contentWorld: .page) as? Double ?? 4.5
    let total = Int((duration * Double(o.fps)).rounded())

    // The video writer.
    let outURL = URL(fileURLWithPath: o.out)
    try? FileManager.default.removeItem(at: outURL)
    let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true // "faststart": the video can play before it fully downloads
    // A high bitrate target. At lower settings Apple's encoder smooths away
    // the fine dither, and the glow shows rings again. (We tested quality 0.9,
    // 20 Mbps and 40 Mbps; only 40 Mbps or quality 1.0 stayed smooth, and
    // 40 Mbps makes smaller files. Simple cards use far less than 40.)
    let compression: [String: Any] = [
        AVVideoAverageBitRateKey: 40_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: Int(o.fps),
        AVVideoExpectedSourceFrameRateKey: Int(o.fps),
        AVVideoAllowFrameReorderingKey: false,
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: WIDTH,
        AVVideoHeightKey: HEIGHT,
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: compression,
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        kCVPixelBufferWidthKey as String: WIDTH,
        kCVPixelBufferHeightKey as String: HEIGHT,
    ])
    writer.add(input)
    guard writer.startWriting() else { fail("could not start the video file: \(writer.error?.localizedDescription ?? "unknown error")") }
    writer.startSession(atSourceTime: .zero)

    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    var rgba = [UInt8](repeating: 0, count: WIDTH * HEIGHT * 4)
    let snapshot = WKSnapshotConfiguration()
    snapshot.rect = NSRect(origin: .zero, size: viewSize)
    snapshot.snapshotWidth = NSNumber(value: Double(WIDTH) / Double(window.backingScaleFactor))
    snapshot.afterScreenUpdates = true

    for i in 0..<total {
        // Move the timeline to this frame's time, then wait until it is drawn.
        _ = try await webView.callAsyncJavaScript("""
            window.__timelines["title-card"].seek(t, false);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            """, arguments: ["t": Double(i) / Double(o.fps)], contentWorld: .page)
        let image = try await webView.takeSnapshot(configuration: snapshot)
        var rect = NSRect(origin: .zero, size: image.size)
        guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fail("could not read frame \(i)") }

        while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
        var pixelBuffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pixelBuffer)
        guard let buf = pixelBuffer else { fail("out of memory at frame \(i)") }
        rgba.withUnsafeMutableBytes { raw in
            // Draw the snapshot into a plain 1920x1080 sRGB picture first.
            let ctx = CGContext(data: raw.baseAddress, width: WIDTH, height: HEIGHT, bitsPerComponent: 8,
                                bytesPerRow: WIDTH * 4, space: srgb,
                                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
            ctx.interpolationQuality = .high
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: WIDTH, height: HEIGHT))
            CVPixelBufferLockBaseAddress(buf, [])
            convertToNV12(raw.baseAddress!.assumingMemoryBound(to: UInt8.self), stride: WIDTH * 4, into: buf)
            CVPixelBufferUnlockBaseAddress(buf, [])
        }
        if !adaptor.append(buf, withPresentationTime: CMTime(value: Int64(i), timescale: o.fps)) {
            fail("could not write frame \(i): \(writer.error?.localizedDescription ?? "unknown error")")
        }
        // For checking the picture: TITLE_CARDS_DUMP_FRAME=60 saves frame 60 as a PNG.
        if ProcessInfo.processInfo.environment["TITLE_CARDS_DUMP_FRAME"] == String(i) {
            let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
            try? png?.write(to: outURL.deletingPathExtension().appendingPathExtension("frame\(i).png"))
        }
        lastProgress = Date()
        print("frame \(i + 1)/\(total)")
        fflush(stdout)
    }

    input.markAsFinished()
    await writer.finishWriting()
    if writer.status != .completed {
        fail("could not finish the video: \(writer.error?.localizedDescription ?? "unknown error")")
    }
    // With "faststart", AVFoundation writes a temporary copy next to the file
    // ("card.mp4.sb-…") and sometimes leaves it behind. Remove it.
    let folder = outURL.deletingLastPathComponent()
    for name in (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    where name.hasPrefix(outURL.lastPathComponent + ".sb-") {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
    }
    window.orderOut(nil)
}

let options = parseOptions()
startWatchdog()
Task { @MainActor in
    do {
        try await run(options)
    } catch {
        fail(error.localizedDescription)
    }
    exit(0)
}
NSApplication.shared.run()
