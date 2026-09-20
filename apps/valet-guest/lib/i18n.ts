'use client';

import { useEffect, useState } from 'react';

/**
 * Language on the guest page.
 *
 * The BRD leaves this open — a hotel's guests may not need the coverage the
 * resident products were built for — so the capability ships and English
 * stays the default. A venue that finds it wants Hindi or Kannada does not
 * then need a release.
 *
 * The chosen language is remembered per browser, not per ticket: a guest who
 * switched once has said something about themselves, not about that car.
 */
export type Lang = 'en' | 'hi' | 'kn';

const STORE_KEY = 'dwaar_valet_guest_lang';

type Dict = Record<string, Record<Lang, string>>;

export const S: Dict = {
  yourCarIsWithUs:   { en: 'Your car is with us', hi: 'आपकी कार हमारे पास है', kn: 'ನಿಮ್ಮ ಕಾರು ನಮ್ಮ ಬಳಿ ಇದೆ' },
  parkingYourCar:    { en: "We're parking your car", hi: 'हम आपकी कार पार्क कर रहे हैं', kn: 'ನಾವು ನಿಮ್ಮ ಕಾರನ್ನು ಪಾರ್ಕ್ ಮಾಡುತ್ತಿದ್ದೇವೆ' },
  willFillIn:        { en: 'This page will fill in as soon as the valet has finished checking it in.', hi: 'वैले के चेक-इन पूरा करते ही यह पेज भर जाएगा।', kn: 'ವ್ಯಾಲೆ ಚೆಕ್-ಇನ್ ಮುಗಿಸಿದ ತಕ್ಷಣ ಈ ಪುಟ ತುಂಬುತ್ತದೆ.' },
  requestMyCar:      { en: 'Request my car', hi: 'मेरी कार मंगवाएँ', kn: 'ನನ್ನ ಕಾರನ್ನು ತರಿಸಿ' },
  requestReceived:   { en: 'Request received', hi: 'अनुरोध मिल गया', kn: 'ವಿನಂತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ' },
  onItsWay:          { en: 'Your car is on its way', hi: 'आपकी कार आ रही है', kn: 'ನಿಮ್ಮ ಕಾರು ಬರುತ್ತಿದೆ' },
  atPickup:          { en: 'Your car is at the pickup point', hi: 'आपकी कार पिकअप पॉइंट पर है', kn: 'ನಿಮ್ಮ ಕಾರು ಪಿಕಪ್ ಪಾಯಿಂಟ್‌ನಲ್ಲಿದೆ' },
  thankYou:          { en: 'Thank You for Visiting', hi: 'पधारने के लिए धन्यवाद', kn: 'ಭೇಟಿ ನೀಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು' },
  returnCard:        { en: 'Please return the card back to the venue', hi: 'कृपया कार्ड वापस कर दें', kn: 'ದಯವಿಟ್ಟು ಕಾರ್ಡ್ ಹಿಂತಿರುಗಿಸಿ' },
  ticket:            { en: 'Ticket', hi: 'टिकट', kn: 'ಟಿಕೆಟ್' },
  howWasIt:          { en: 'How was your valet?', hi: 'वैले सेवा कैसी रही?', kn: 'ವ್ಯಾಲೆ ಸೇವೆ ಹೇಗಿತ್ತು?' },
  satisfied:         { en: 'Satisfied', hi: 'संतुष्ट', kn: 'ತೃಪ್ತಿ' },
  notSatisfied:      { en: 'Not satisfied', hi: 'असंतुष्ट', kn: 'ಅತೃಪ್ತಿ' },
  thanksForTelling:  { en: 'Thanks for letting us know.', hi: 'बताने के लिए धन्यवाद।', kn: 'ತಿಳಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.' },
  collectWithin:     { en: 'Please collect within', hi: 'कृपया इतने समय में ले जाएँ', kn: 'ದಯವಿಟ್ಟು ಇಷ್ಟರೊಳಗೆ ತೆಗೆದುಕೊಳ್ಳಿ' },
  mayBeReparked:     { en: 'Your car may be re-parked — please see the valet desk.', hi: 'आपकी कार दोबारा पार्क की जा सकती है — वैले डेस्क पर संपर्क करें।', kn: 'ನಿಮ್ಮ ಕಾರನ್ನು ಮತ್ತೆ ಪಾರ್ಕ್ ಮಾಡಬಹುದು — ವ್ಯಾಲೆ ಡೆಸ್ಕ್ ಸಂಪರ್ಕಿಸಿ.' },
};

export function useLang(): [Lang, (l: Lang) => void, (k: keyof typeof S) => string] {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY) as Lang | null;
      if (saved === 'en' || saved === 'hi' || saved === 'kn') {
        setLangState(saved);
        return;
      }
      // Only ever an opening guess. English remains the fallback, because a
      // guest whose phone is set to a language we translate badly is worse off
      // than one reading English they already navigated a hotel in.
      const nav = navigator.language?.slice(0, 2);
      if (nav === 'hi' || nav === 'kn') setLangState(nav);
    } catch {
      /* private mode, or storage blocked — English is a fine answer */
    }
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem(STORE_KEY, l); } catch { /* not worth failing over */ }
  }

  return [lang, setLang, (k) => S[k]?.[lang] ?? S[k]?.en ?? String(k)];
}
