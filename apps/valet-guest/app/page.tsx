/**
 * The bare /valet index.
 *
 * Nobody reaches this in normal use: every real entry point is /valet/v/<token>,
 * encoded in the QR printed on a physical valet card. Someone who lands here
 * typed the URL, so the page's whole job is to say "there is nothing to do
 * here, and that is not a fault" — the previous copy ("Scan your valet card to
 * continue") read as an instruction this page would carry out, which made an
 * empty screen look like a scanner that had failed to load.
 */
export default function Index() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <svg
          viewBox="0 0 64 64"
          className="w-16 h-16 mx-auto mb-6 text-teal-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* A QR card, not a camera: the scanning happens on the guest's own
              phone, pointed at the printed card. */}
          <rect x="8" y="12" width="48" height="40" rx="5" />
          <rect x="16" y="20" width="10" height="10" rx="1.5" />
          <rect x="38" y="20" width="10" height="10" rx="1.5" />
          <rect x="16" y="38" width="10" height="6" rx="1.5" />
          <path d="M38 38h4M46 38h2M38 44h10" />
        </svg>

        <h1 className="text-lg font-semibold text-white">
          Your valet card opens this page
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Point your phone&apos;s camera at the QR code on the card the valet
          handed you. It opens your vehicle&apos;s page, where you can track it
          and request it when you&apos;re ready.
        </p>

        <p className="mt-6 text-xs text-white/35">
          There is nothing to scan or sign in to on this screen.
        </p>

        <div className="mt-10 pt-6 border-t border-white/10">
          <p className="text-xs text-white/40">
            Lost your card, or the code won&apos;t open?
            <br />
            Please ask the valet desk — they can look up your vehicle.
          </p>
        </div>
      </div>
    </main>
  );
}
