import AppKit
// Draws a "distribution board" test picture as JPEG (V1.5 phase A fixtures in test/fixtures/photos; no camera, no download).
// Usage: swiftc -O scripts/fixtures/draw-photo.swift -o <scratch>/draw-photo && <scratch>/draw-photo <out.jpg> <width> <height> <label>
let a = CommandLine.arguments
let w = Int(a[2])!, h = Int(a[3])!, label = a[4]
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let g = NSGradient(starting: NSColor(calibratedRed: 0.86, green: 0.87, blue: 0.84, alpha: 1), ending: NSColor(calibratedRed: 0.62, green: 0.64, blue: 0.60, alpha: 1))!
g.draw(in: NSRect(x: 0, y: 0, width: w, height: h), angle: 70)
let rows = 3, cols = 12
let mw = Double(w) * 0.8 / Double(cols), mh = Double(h) * 0.18
for r in 0..<rows {
  let y = Double(h) * (0.12 + 0.28 * Double(r))
  NSColor(calibratedWhite: 0.25, alpha: 1).setFill()
  NSRect(x: Double(w) * 0.08, y: y + mh * 0.45, width: Double(w) * 0.84, height: mh * 0.1).fill()
  for c in 0..<cols {
    let x = Double(w) * 0.1 + Double(c) * mw
    NSColor(calibratedWhite: 0.97, alpha: 1).setFill()
    let box = NSRect(x: x + 2, y: y, width: mw - 4, height: mh)
    NSBezierPath(roundedRect: box, xRadius: 3, yRadius: 3).fill()
    (c % 4 == 0 ? NSColor.systemBlue : NSColor.darkGray).setFill()
    NSRect(x: x + mw * 0.3, y: y + mh * 0.35, width: mw * 0.4, height: mh * 0.3).fill()
    let t = "F\(r * cols + c + 1)" as NSString
    t.draw(at: NSPoint(x: x + mw * 0.2, y: y + mh * 0.75), withAttributes: [.font: NSFont.systemFont(ofSize: mh * 0.12), .foregroundColor: NSColor.black])
  }
}
(label as NSString).draw(at: NSPoint(x: Double(w) * 0.05, y: Double(h) * 0.93), withAttributes: [.font: NSFont.boldSystemFont(ofSize: Double(h) * 0.04), .foregroundColor: NSColor.black])
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: a[1]))
