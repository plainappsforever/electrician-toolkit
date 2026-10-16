// Device-free PDF of a report HTML with macOS WebKit (V1.5 phase A, docs/V15_LOG.md A6): the iPhone prints the report with
// WKWebView (expo-print); macOS WebKit is the same engine family, so a page layout problem (a cut picture, a lost
// signature) shows here without a simulator. It is NOT the phone: page breaks can differ in detail (L8).
// No dependency: Swift + AppKit + WebKit from Xcode. Paginates with NSPrintOperation like a print job.
// Usage: swiftc -O scripts/html-to-pdf.swift -o <scratch>/html-to-pdf
//        <scratch>/html-to-pdf <in.html> <out.pdf> <widthPt> <heightPt> [topAndBottomMarginPt]
// (the iOS print profile hands expo-print 31 pt top and bottom margins, src/lib/print-html.ts)
import AppKit
import WebKit

let args = CommandLine.arguments
if args.count < 5 || Double(args[3]) == nil || Double(args[4]) == nil {
  print("usage: html-to-pdf <in.html> <out.pdf> <widthPt> <heightPt> [topAndBottomMarginPt]")
  exit(2)
}
let w = Double(args[3])!
let h = Double(args[4])!
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let margin = args.count > 5 ? Double(args[5]) ?? 0 : 0

final class Printer: NSObject, WKNavigationDelegate {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let info = NSPrintInfo()
    info.paperSize = NSSize(width: w, height: h)
    info.topMargin = margin
    info.bottomMargin = margin
    info.leftMargin = 0
    info.rightMargin = 0
    info.horizontalPagination = .fit
    info.verticalPagination = .automatic
    info.jobDisposition = .save
    info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = outURL
    let op = webView.printOperation(with: info)
    op.showsPrintPanel = false
    op.showsProgressPanel = false
    op.view?.frame = NSRect(x: 0, y: 0, width: w, height: h)
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = webView
    op.runModal(for: window, delegate: self, didRun: #selector(done(_:success:contextInfo:)), contextInfo: nil)
  }
  @objc func done(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    print(success ? "ok \(outURL.path)" : "failed")
    exit(success ? 0 : 1)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h))
let printer = Printer()
web.navigationDelegate = printer
web.loadFileURL(inURL, allowingReadAccessTo: inURL.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 120) {
  print("timeout")
  exit(2)
}
app.run()
