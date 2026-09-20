import QRCode from 'qrcode';

/** Renders a string as a PNG data URL, sized for on-screen display. */
export async function toDataUrl(text) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#1A1F2E', light: '#FFFFFF' },
  });
}
