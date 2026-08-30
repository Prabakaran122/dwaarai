/**
 * The guest app has no index worth showing: every real entry point is a
 * /v/<token> URL encoded in a physical valet card's QR.
 */
export default function Index() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <p className="text-white font-semibold">Scan your valet card to continue.</p>
        <p className="text-sm text-white/50 mt-2">
          The QR on the card opens your vehicle&apos;s page.
        </p>
      </div>
    </main>
  );
}
