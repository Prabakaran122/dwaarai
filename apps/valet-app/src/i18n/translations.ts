// Sarthi valet i18n — English / Hindi / Kannada.
// Valets, like guards, may not read English.

export type Lang = 'en' | 'hi' | 'kn';

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
];

type Dict = Record<string, { en: string; hi: string; kn: string }>;

export const translations: Dict = {
  // common
  cancel: { en: 'Cancel', hi: 'रद्द करें', kn: 'ರದ್ದುಮಾಡಿ' },
  error: { en: 'Error', hi: 'त्रुटि', kn: 'ದೋಷ' },
  done: { en: 'Done', hi: 'पूर्ण', kn: 'ಮುಗಿದಿದೆ' },
  username: { en: 'Username', hi: 'उपयोगकर्ता नाम', kn: 'ಬಳಕೆದಾರ ಹೆಸರು' },
  password: { en: 'Password', hi: 'पासवर्ड', kn: 'ಪಾಸ್‌ವರ್ಡ್' },
  signIn: { en: 'Sign In', hi: 'साइन इन करें', kn: 'ಸೈನ್ ಇನ್' },
  signOut: { en: 'Sign out', hi: 'साइन आउट', kn: 'ಸೈನ್ ಔಟ್' },
  loginFailed: { en: 'Login failed', hi: 'लॉगिन विफल', kn: 'ಲಾಗಿನ್ ವಿಫಲವಾಗಿದೆ' },
  valetStation: { en: 'Valet Station', hi: 'वैले स्टेशन', kn: 'ವ್ಯಾಲೆ ಸ್ಟೇಷನ್' },

  valetTitle: { en: 'Valet', hi: 'वैले', kn: 'ವ್ಯಾಲೆ' },
  valetNewTicket: { en: 'New', hi: 'नया', kn: 'ಹೊಸ' },
  valetWaiting: { en: '{n} guest(s) waiting', hi: '{n} मेहमान प्रतीक्षा में', kn: '{n} ಅತಿಥಿಗಳು ಕಾಯುತ್ತಿದ್ದಾರೆ' },
  valetNobodyWaiting: { en: 'Nobody is waiting', hi: 'कोई प्रतीक्षा में नहीं', kn: 'ಯಾರೂ ಕಾಯುತ್ತಿಲ್ಲ' },
  valetEmpty: { en: 'No open valet tickets', hi: 'कोई खुला वैले टिकट नहीं', kn: 'ಯಾವುದೇ ತೆರೆದ ವ್ಯಾಲೆ ಟಿಕೆಟ್ ಇಲ್ಲ' },
  valetAccept: { en: 'Accept', hi: 'स्वीकार करें', kn: 'ಸ್ವೀಕರಿಸಿ' },
  valetNotSure: { en: 'Not sure', hi: 'पता नहीं', kn: 'ಖಚಿತವಿಲ್ಲ' },
  valetArrived: { en: 'Arrived at pickup', hi: 'पिकअप पर पहुंचा', kn: 'ಪಿಕಪ್‌ಗೆ ಬಂದಿದೆ' },
  valetScanQr: { en: 'Scan guest QR', hi: 'मेहमान का QR स्कैन करें', kn: 'ಅತಿಥಿ QR ಸ್ಕ್ಯಾನ್ ಮಾಡಿ' },
  valetDisputed: { en: 'Disputed', hi: 'विवादित', kn: 'ವಿವಾದಿತ' },
  valetStatus_parked: { en: 'Parked', hi: 'पार्क किया', kn: 'ಪಾರ್ಕ್ ಆಗಿದೆ' },
  valetStatus_requested: { en: 'Requested', hi: 'अनुरोध किया', kn: 'ವಿನಂತಿಸಲಾಗಿದೆ' },
  valetStatus_en_route: { en: 'On the way', hi: 'रास्ते में', kn: 'ದಾರಿಯಲ್ಲಿದೆ' },
  valetStatus_arrived: { en: 'At pickup', hi: 'पिकअप पर', kn: 'ಪಿಕಪ್‌ನಲ್ಲಿ' },
  valetStatus_parked_again: { en: 'Parked again', hi: 'फिर पार्क किया', kn: 'ಮತ್ತೆ ಪಾರ್ಕ್ ಆಗಿದೆ' },
  valetStatus_final_closed: { en: 'Checked out', hi: 'चेक आउट', kn: 'ಚೆಕ್ ಔಟ್' },
  valetStatus_expired: { en: 'Expired', hi: 'समाप्त', kn: 'ಅವಧಿ ಮುಗಿದಿದೆ' },
  valetPlate: { en: 'Vehicle number', hi: 'वाहन नंबर', kn: 'ವಾಹನ ಸಂಖ್ಯೆ' },
  valetMake: { en: 'Make / model', hi: 'मेक / मॉडल', kn: 'ಮೇಕ್ / ಮಾಡೆಲ್' },
  valetStayEnd: { en: 'Leaving on', hi: 'प्रस्थान', kn: 'ನಿರ್ಗಮನ' },
  valetCreate: { en: 'Create ticket', hi: 'टिकट बनाएं', kn: 'ಟಿಕೆಟ್ ರಚಿಸಿ' },
  valetReturning: { en: 'Returning vehicle, visited {n} time(s)', hi: 'वापसी वाहन, {n} बार आया', kn: 'ಮರಳಿದ ವಾಹನ, {n} ಬಾರಿ ಬಂದಿದೆ' },
  valetShowQr: { en: 'Show this QR to the guest', hi: 'यह QR मेहमान को दिखाएं', kn: 'ಈ QR ಅನ್ನು ಅತಿಥಿಗೆ ತೋರಿಸಿ' },
  valetCapturePhoto: { en: 'Capture guest photo', hi: 'मेहमान की फोटो लें', kn: 'ಅತಿಥಿಯ ಫೋಟೋ ತೆಗೆಯಿರಿ' },
  valetSkipPhoto: { en: 'Skip for now', hi: 'अभी छोड़ें', kn: 'ಸದ್ಯಕ್ಕೆ ಬಿಟ್ಟುಬಿಡಿ' },
  valetConditionIntake: { en: 'Capture vehicle condition', hi: 'वाहन की स्थिति कैप्चर करें', kn: 'ವಾಹನದ ಸ್ಥಿತಿ ಸೆರೆಹಿಡಿಯಿರಿ' },
  valetConditionRequired: { en: 'Capture at least one photo or video first', hi: 'पहले कम से कम एक फोटो या वीडियो लें', kn: 'ಮೊದಲು ಕನಿಷ್ಠ ಒಂದು ಫೋಟೋ ಅಥವಾ ವೀಡಿಯೊ ತೆಗೆಯಿರಿ' },
  valetCameraDenied: { en: 'Camera permission is needed for this step', hi: 'इस चरण के लिए कैमरा अनुमति चाहिए', kn: 'ಈ ಹಂತಕ್ಕೆ ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ಬೇಕು' },
  valetFailed: { en: 'That action failed, try again', hi: 'कार्रवाई विफल, फिर कोशिश करें', kn: 'ಕ್ರಿಯೆ ವಿಫಲವಾಗಿದೆ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ' },
  valetQrExpired: { en: 'QR expired, ask the guest to let it refresh', hi: 'QR समाप्त, मेहमान से रिफ्रेश होने दें', kn: 'QR ಅವಧಿ ಮುಗಿದಿದೆ, ಅತಿಥಿಯನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಲು ಕೇಳಿ' },
  valetScanRequired: { en: 'Scan the guest QR first', hi: 'पहले मेहमान का QR स्कैन करें', kn: 'ಮೊದಲು ಅತಿಥಿ QR ಸ್ಕ್ಯಾನ್ ಮಾಡಿ' },
  valetScanHint: { en: 'Point the camera at the QR on the guest\'s phone', hi: 'कैमरा मेहमान के फोन के QR पर रखें', kn: 'ಕ್ಯಾಮೆರಾವನ್ನು ಅತಿಥಿಯ ಫೋನ್‌ನ QR ಗೆ ಗುರಿಮಾಡಿ' },
  valetGrantCamera: { en: 'Allow camera', hi: 'कैमरा अनुमति दें', kn: 'ಕ್ಯಾಮೆರಾ ಅನುಮತಿಸಿ' },
  valetCompareGuest: { en: 'Compare with the guest', hi: 'मेहमान से मिलान करें', kn: 'ಅತಿಥಿಯೊಂದಿಗೆ ಹೋಲಿಸಿ' },
  valetCompareHint: { en: 'Check this is the same person before handing over the car', hi: 'गाड़ी देने से पहले जांचें कि यह वही व्यक्ति है', kn: 'ಕಾರು ನೀಡುವ ಮೊದಲು ಇದೇ ವ್ಯಕ್ತಿ ಎಂದು ಪರಿಶೀಲಿಸಿ' },
  valetMatches: { en: 'Person matches', hi: 'व्यक्ति मेल खाता है', kn: 'ವ್ಯಕ್ತಿ ಹೊಂದಿಕೆಯಾಗುತ್ತಾರೆ' },
  valetConditionReturn: { en: 'Capture condition at return', hi: 'वापसी पर स्थिति कैप्चर करें', kn: 'ಹಿಂತಿರುಗುವಾಗ ಸ್ಥಿತಿ ಸೆರೆಹಿಡಿಯಿರಿ' },
  valetConfirmTitle: { en: 'Confirm handover', hi: 'सौंपने की पुष्टि करें', kn: 'ಹಸ್ತಾಂತರ ದೃಢೀಕರಿಸಿ' },
  valetParkAgain: { en: 'Handed over, staying longer', hi: 'सौंप दिया, अभी रुकेंगे', kn: 'ಹಸ್ತಾಂತರಿಸಲಾಗಿದೆ, ಇನ್ನೂ ಇರುತ್ತಾರೆ' },
  valetFinalCheckout: { en: 'Final checkout', hi: 'अंतिम चेकआउट', kn: 'ಅಂತಿಮ ಚೆಕ್‌ಔಟ್' },
  valetSearchPlate: { en: 'Search by vehicle number', hi: 'वाहन नंबर से खोजें', kn: 'ವಾಹನ ಸಂಖ್ಯೆಯಿಂದ ಹುಡುಕಿ' },
  valetNoMatch: { en: 'No vehicle matches that number', hi: 'उस नंबर का कोई वाहन नहीं', kn: 'ಆ ಸಂಖ್ಯೆಯ ವಾಹನ ಇಲ್ಲ' },
  valetScanCard: { en: 'Scan valet card', hi: 'वैले कार्ड स्कैन करें', kn: 'ವ್ಯಾಲೆ ಕಾರ್ಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ' },
  valetCardBound: { en: 'Card {c}', hi: 'कार्ड {c}', kn: 'ಕಾರ್ಡ್ {c}' },
  valetNoCard: { en: 'No card — show the QR on screen', hi: 'कार्ड नहीं — स्क्रीन पर QR दिखाएं', kn: 'ಕಾರ್ಡ್ ಇಲ್ಲ — ಪರದೆಯಲ್ಲಿ QR ತೋರಿಸಿ' },
  valetCardInUse: { en: 'That card is already on another vehicle', hi: 'वह कार्ड पहले से दूसरे वाहन पर है', kn: 'ಆ ಕಾರ್ಡ್ ಈಗಾಗಲೇ ಬೇರೆ ವಾಹನದಲ್ಲಿದೆ' },
  valetCardUnknown: { en: 'That card is not registered here', hi: 'वह कार्ड यहां पंजीकृत नहीं', kn: 'ಆ ಕಾರ್ಡ್ ಇಲ್ಲಿ ನೋಂದಾಯಿಸಿಲ್ಲ' },
  valetCardTypeIt: { en: 'Or type the code on the card', hi: 'या कार्ड पर लिखा कोड टाइप करें', kn: 'ಅಥವಾ ಕಾರ್ಡ್‌ನಲ್ಲಿರುವ ಕೋಡ್ ಟೈಪ್ ಮಾಡಿ' },
  valetCardUse: { en: 'Use this card', hi: 'यह कार्ड उपयोग करें', kn: 'ಈ ಕಾರ್ಡ್ ಬಳಸಿ' },
  valetCardNotACard: { en: "That QR is not a valet card", hi: 'वह QR वैले कार्ड नहीं है', kn: 'ಆ QR ವ್ಯಾಲೆ ಕಾರ್ಡ್ ಅಲ್ಲ' },
  valetCardRemove: { en: 'Remove card', hi: 'कार्ड हटाएं', kn: 'ಕಾರ್ಡ್ ತೆಗೆಯಿರಿ' },
  valetCardHandOver: { en: 'Hand the card to the guest', hi: 'कार्ड मेहमान को दें', kn: 'ಕಾರ್ಡ್ ಅತಿಥಿಗೆ ನೀಡಿ' },
  valetNoPhotoTaken: { en: 'No photo was taken at intake', hi: 'गाड़ी लेते समय फोटो नहीं ली गई', kn: 'ವಾಹನ ಪಡೆಯುವಾಗ ಫೋಟೋ ತೆಗೆದಿಲ್ಲ' },
  valetConfirmVehicleHint: { en: 'Ask the guest to tell you the vehicle and its number before releasing the car.', hi: 'गाड़ी देने से पहले मेहमान से वाहन और उसका नंबर पूछें।', kn: 'ವಾಹನ ಬಿಡುಗಡೆ ಮಾಡುವ ಮೊದಲು ಅತಿಥಿಯಿಂದ ವಾಹನ ಮತ್ತು ಅದರ ಸಂಖ್ಯೆ ಕೇಳಿ.' },
  valetGuestConfirmed: { en: 'Guest confirmed — release car', hi: 'मेहमान ने बताया — गाड़ी दें', kn: 'ಅತಿಥಿ ಖಚಿತಪಡಿಸಿದರು — ವಾಹನ ನೀಡಿ' },
  valetCannotConfirm: { en: 'Cannot confirm — hold the car', hi: 'पुष्टि नहीं — गाड़ी रोकें', kn: 'ಖಚಿತಪಡಿಸಲಾಗಿಲ್ಲ — ವಾಹನ ತಡೆಹಿಡಿಯಿರಿ' },
  valetCameraBlocked: { en: 'Camera is blocked for Sarthi. Turn it on in Settings.', hi: 'सारथी के लिए कैमरा बंद है। सेटिंग्स में चालू करें।', kn: 'ಸಾರಥಿಗೆ ಕ್ಯಾಮೆರಾ ನಿರ್ಬಂಧಿಸಲಾಗಿದೆ. ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಆನ್ ಮಾಡಿ.' },
  valetOpenSettings: { en: 'Open settings', hi: 'सेटिंग्स खोलें', kn: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು ತೆರೆಯಿರಿ' },
  valetCameraFailed: { en: 'The camera did not open', hi: 'कैमरा नहीं खुला', kn: 'ಕ್ಯಾಮೆರಾ ತೆರೆಯಲಿಲ್ಲ' },
  valetOrTellGuest: { en: 'Or the guest can go here and enter', hi: 'या मेहमान यहां जाकर डाल सकते हैं', kn: 'ಅಥವಾ ಅತಿಥಿ ಇಲ್ಲಿಗೆ ಹೋಗಿ ನಮೂದಿಸಬಹುದು' },
};

export function translate(key: string, lang: Lang): string {
  const entry = translations[key];
  if (!entry) return key;            // unknown key → show the key (dev signal)
  return entry[lang] || entry.en;    // missing translation → English fallback
}
