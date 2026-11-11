const qrcode = require('qrcode-generator')

// a QR code as SVG, for the phone of a student or of the user: only
// attributes, no style, so it passes a CSP without inline styles
export function qr(text: string): string {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createSvgTag({ cellSize: 2, margin: 2, scalable: true })
}
