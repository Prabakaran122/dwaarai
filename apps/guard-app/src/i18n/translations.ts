// Guard App i18n dictionary — English / Hindi / Kannada (spec 3.9).
// Technical acronyms (ANPR, RFID, FASTag, OTP) are intentionally left untranslated.

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
  send: { en: 'Send', hi: 'भेजें', kn: 'ಕಳುಹಿಸಿ' },
  submit: { en: 'Submit', hi: 'जमा करें', kn: 'ಸಲ್ಲಿಸಿ' },
  done: { en: 'Done', hi: 'पूर्ण', kn: 'ಮುಗಿದಿದೆ' },
  dismiss: { en: 'Dismiss', hi: 'खारिज करें', kn: 'ತಿರಸ್ಕರಿಸಿ' },

  // login
  guardStation: { en: 'Guard Station', hi: 'गार्ड स्टेशन', kn: 'ಗಾರ್ಡ್ ಸ್ಟೇಷನ್' },
  username: { en: 'Username', hi: 'उपयोगकर्ता नाम', kn: 'ಬಳಕೆದಾರ ಹೆಸರು' },
  password: { en: 'Password', hi: 'पासवर्ड', kn: 'ಪಾಸ್‌ವರ್ಡ್' },
  signIn: { en: 'Sign In', hi: 'साइन इन करें', kn: 'ಸೈನ್ ಇನ್' },
  loginFailed: { en: 'Login failed', hi: 'लॉगिन विफल', kn: 'ಲಾಗಿನ್ ವಿಫಲವಾಗಿದೆ' },

  // workstation
  mainGate: { en: 'Main Gate', hi: 'मुख्य द्वार', kn: 'ಮುಖ್ಯ ಗೇಟ್' },
  guard: { en: 'Guard', hi: 'गार्ड', kn: 'ಗಾರ್ಡ್' },
  endShift: { en: 'End Shift', hi: 'शिफ्ट समाप्त करें', kn: 'ಶಿಫ್ಟ್ ಮುಗಿಸಿ' },
  endShiftConfirm: { en: 'Are you sure you want to logout?', hi: 'क्या आप लॉगआउट करना चाहते हैं?', kn: 'ನೀವು ಲಾಗ್ ಔಟ್ ಮಾಡಲು ಬಯಸುವಿರಾ?' },
  logout: { en: 'Logout', hi: 'लॉगआउट', kn: 'ಲಾಗ್ ಔಟ್' },

  // action zone
  allClear: { en: 'All Clear', hi: 'सब ठीक है', kn: 'ಎಲ್ಲವೂ ಸರಿ' },
  noVehiclesPending: { en: 'No vehicles pending review', hi: 'समीक्षा के लिए कोई वाहन लंबित नहीं', kn: 'ಪರಿಶೀಲನೆಗೆ ಬಾಕಿ ಇರುವ ವಾಹನಗಳಿಲ್ಲ' },
  fastagAutoPaired: { en: 'FASTag auto-paired', hi: 'FASTag स्वतः जुड़ा', kn: 'FASTag ಸ್ವಯಂ-ಜೋಡಿಸಲಾಗಿದೆ' },
  approve: { en: 'Approve', hi: 'स्वीकृत करें', kn: 'ಅನುಮೋದಿಸಿ' },
  deny: { en: 'Deny', hi: 'अस्वीकार करें', kn: 'ನಿರಾಕರಿಸಿ' },
  approveRegister: { en: 'Approve + Register', hi: 'स्वीकृत + पंजीकृत', kn: 'ಅನುಮೋದಿಸಿ + ನೋಂದಣಿ' },
  requestApproval: { en: 'Request Approval', hi: 'स्वीकृति का अनुरोध', kn: 'ಅನುಮೋದನೆ ವಿನಂತಿ' },
  requestApprovalTitle: { en: 'REQUEST APPROVAL', hi: 'स्वीकृति का अनुरोध', kn: 'ಅನುಮೋದನೆ ವಿನಂತಿ' },
  visitorName: { en: 'Visitor name', hi: 'आगंतुक का नाम', kn: 'ಭೇಟಿದಾರರ ಹೆಸರು' },
  unitNumber: { en: 'Unit number', hi: 'यूनिट नंबर', kn: 'ಯೂನಿಟ್ ಸಂಖ್ಯೆ' },
  registerVehicle: { en: 'REGISTER VEHICLE', hi: 'वाहन पंजीकृत करें', kn: 'ವಾಹನ ನೋಂದಣಿ' },
  registerOpen: { en: 'Register & Open', hi: 'पंजीकृत करें और खोलें', kn: 'ನೋಂದಾಯಿಸಿ ಮತ್ತು ತೆರೆಯಿರಿ' },
  failOpenGate: { en: 'Failed to open gate', hi: 'गेट खोलने में विफल', kn: 'ಗೇಟ್ ತೆರೆಯಲು ವಿಫಲವಾಗಿದೆ' },
  failDeny: { en: 'Failed to send deny command', hi: 'अस्वीकार आदेश भेजने में विफल', kn: 'ನಿರಾಕರಣೆ ಆದೇಶ ಕಳುಹಿಸಲು ವಿಫಲ' },
  failRegister: { en: 'Registration failed', hi: 'पंजीकरण विफल', kn: 'ನೋಂದಣಿ ವಿಫಲವಾಗಿದೆ' },
  failApproval: { en: 'Failed to request approval', hi: 'स्वीकृति अनुरोध विफल', kn: 'ಅನುಮೋದನೆ ವಿನಂತಿ ವಿಫಲ' },

  // approval waiting
  approvalRequest: { en: 'APPROVAL REQUEST', hi: 'स्वीकृति अनुरोध', kn: 'ಅನುಮೋದನೆ ವಿನಂತಿ' },
  resident: { en: 'Resident', hi: 'निवासी', kn: 'ನಿವಾಸಿ' },
  deniedByResident: { en: 'Denied by Resident', hi: 'निवासी द्वारा अस्वीकृत', kn: 'ನಿವಾಸಿಯಿಂದ ನಿರಾಕರಿಸಲಾಗಿದೆ' },
  noResponse: { en: 'No Response', hi: 'कोई प्रतिक्रिया नहीं', kn: 'ಪ್ರತಿಕ್ರಿಯೆ ಇಲ್ಲ' },

  // expected visitors
  arrived: { en: 'Arrived', hi: 'पहुंच गए', kn: 'ಬಂದಿದ್ದಾರೆ' },
  expectedNow: { en: 'EXPECTED NOW', hi: 'अभी अपेक्षित', kn: 'ಈಗ ನಿರೀಕ್ಷಿತ' },
  arrivedToday: { en: 'ARRIVED TODAY', hi: 'आज पहुंचे', kn: 'ಇಂದು ಬಂದವರು' },
  permissionRequired: { en: 'Permission Required', hi: 'अनुमति आवश्यक', kn: 'ಅನುಮತಿ ಅಗತ್ಯ' },
  cameraNeeded: { en: 'Camera access is needed to take visitor photo', hi: 'आगंतुक की फ़ोटो के लिए कैमरा अनुमति चाहिए', kn: 'ಭೇಟಿದಾರರ ಫೋಟೋಗೆ ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ಬೇಕು' },
  failMarkArrived: { en: 'Failed to mark arrived', hi: 'पहुंच दर्ज करने में विफल', kn: 'ಬಂದಿರುವುದನ್ನು ಗುರುತಿಸಲು ವಿಫಲ' },

  // feed / status
  statusAllowed: { en: 'ALLOWED', hi: 'अनुमति', kn: 'ಅನುಮತಿ' },
  statusDenied: { en: 'DENIED', hi: 'अस्वीकृत', kn: 'ನಿರಾಕರಿಸಲಾಗಿದೆ' },
  statusReview: { en: 'REVIEW', hi: 'समीक्षा', kn: 'ಪರಿಶೀಲನೆ' },
  liveFeed: { en: 'LIVE FEED', hi: 'लाइव फ़ीड', kn: 'ಲೈವ್ ಫೀಡ್' },
  waitingEvents: { en: 'Waiting for events...', hi: 'घटनाओं की प्रतीक्षा...', kn: 'ಘಟನೆಗಳಿಗಾಗಿ ಕಾಯಲಾಗುತ್ತಿದೆ...' },

  // incident
  logIncident: { en: 'Log Incident', hi: 'घटना दर्ज करें', kn: 'ಘಟನೆ ದಾಖಲಿಸಿ' },
  logIncidentTitle: { en: 'LOG INCIDENT', hi: 'घटना दर्ज करें', kn: 'ಘಟನೆ ದಾಖಲಿಸಿ' },
  description: { en: 'Description (optional)', hi: 'विवरण (वैकल्पिक)', kn: 'ವಿವರಣೆ (ಐಚ್ಛಿಕ)' },
  incidentLogged: { en: 'Incident Logged', hi: 'घटना दर्ज हुई', kn: 'ಘಟನೆ ದಾಖಲಾಗಿದೆ' },
  reportSubmitted: { en: 'Report submitted successfully.', hi: 'रिपोर्ट सफलतापूर्वक जमा हुई।', kn: 'ವರದಿ ಯಶಸ್ವಿಯಾಗಿ ಸಲ್ಲಿಸಲಾಗಿದೆ.' },
  failIncident: { en: 'Failed to submit incident', hi: 'घटना जमा करने में विफल', kn: 'ಘಟನೆ ಸಲ್ಲಿಸಲು ವಿಫಲ' },
  incUnauthorized: { en: 'Unauthorized', hi: 'अनधिकृत', kn: 'ಅನಧಿಕೃತ' },
  incTailgating: { en: 'Tailgating', hi: 'टेलगेटिंग', kn: 'ಟೈಲ್‌ಗೇಟಿಂಗ್' },
  incSuspicious: { en: 'Suspicious', hi: 'संदिग्ध', kn: 'ಶಂಕಾಸ್ಪದ' },
  incDamage: { en: 'Damage', hi: 'क्षति', kn: 'ಹಾನಿ' },
  incEquipment: { en: 'Equipment', hi: 'उपकरण', kn: 'ಸಲಕರಣೆ' },
  incOther: { en: 'Other', hi: 'अन्य', kn: 'ಇತರೆ' },

  // OTP
  verifyVisitor: { en: 'VERIFY VISITOR', hi: 'आगंतुक सत्यापित करें', kn: 'ಭೇಟಿದಾರರನ್ನು ಪರಿಶೀಲಿಸಿ' },
  verify: { en: 'Verify', hi: 'सत्यापित करें', kn: 'ಪರಿಶೀಲಿಸಿ' },
  openGate: { en: 'Open Gate', hi: 'गेट खोलें', kn: 'ಗೇಟ್ ತೆರೆಯಿರಿ' },
  verified: { en: 'VERIFIED', hi: 'सत्यापित', kn: 'ಪರಿಶೀಲಿಸಲಾಗಿದೆ' },
  invalidOtp: { en: 'INVALID OTP', hi: 'अमान्य OTP', kn: 'ಅಮಾನ್ಯ OTP' },

  // shift stats
  shift: { en: 'SHIFT', hi: 'शिफ्ट', kn: 'ಶಿಫ್ಟ್' },
  entries: { en: 'Entries', hi: 'प्रवेश', kn: 'ಪ್ರವೇಶಗಳು' },
  denied: { en: 'Denied', hi: 'अस्वीकृत', kn: 'ನಿರಾಕರಿಸಲಾಗಿದೆ' },
  visitors: { en: 'Visitors', hi: 'आगंतुक', kn: 'ಭೇಟಿದಾರರು' },

  // SOS / emergency
  sos: { en: 'SOS', hi: 'SOS', kn: 'SOS' },
  emergencyHelp: { en: 'Emergency', hi: 'आपातकाल', kn: 'ತುರ್ತು' },
  raiseEmergency: { en: 'Raise an emergency', hi: 'आपातकाल सूचित करें', kn: 'ತುರ್ತು ಎಚ್ಚರಿಕೆ ನೀಡಿ' },
  sosMedical: { en: 'Medical', hi: 'चिकित्सा', kn: 'ವೈದ್ಯಕೀಯ' },
  sosFire: { en: 'Fire', hi: 'आग', kn: 'ಬೆಂಕಿ' },
  sosSecurity: { en: 'Security', hi: 'सुरक्षा', kn: 'ಭದ್ರತೆ' },
  sosOther: { en: 'Other', hi: 'अन्य', kn: 'ಇತರೆ' },
  sosActive: { en: 'EMERGENCY ACTIVE', hi: 'आपातकाल सक्रिय', kn: 'ತುರ್ತು ಸಕ್ರಿಯ' },
  resolve: { en: 'Resolve', hi: 'हल करें', kn: 'ಪರಿಹರಿಸಿ' },
  atGate: { en: 'at', hi: 'द्वार', kn: 'ಗೇಟ್' },

  // deliveries
  logDelivery: { en: 'Log Delivery', hi: 'डिलीवरी दर्ज करें', kn: 'ಡೆಲಿವರಿ ದಾಖಲಿಸಿ' },
  newDelivery: { en: 'NEW DELIVERY', hi: 'नई डिलीवरी', kn: 'ಹೊಸ ಡೆಲಿವರಿ' },
  deliveriesWaiting: { en: 'DELIVERIES WAITING', hi: 'प्रतीक्षारत डिलीवरी', kn: 'ಕಾಯುತ್ತಿರುವ ಡೆಲಿವರಿಗಳು' },
  company: { en: 'Delivery company', hi: 'डिलीवरी कंपनी', kn: 'ಡೆಲಿವರಿ ಕಂಪನಿ' },
  delivered: { en: 'Delivered', hi: 'पहुंचाया', kn: 'ತಲುಪಿಸಲಾಗಿದೆ' },
  leftAtGate: { en: 'Left at gate', hi: 'गेट पर छोड़ा', kn: 'ಗೇಟ್‌ನಲ್ಲಿ ಬಿಡಲಾಗಿದೆ' },
  failDelivery: { en: 'Failed to log delivery', hi: 'डिलीवरी दर्ज करने में विफल', kn: 'ಡೆಲಿವರಿ ದಾಖಲಿಸಲು ವಿಫಲ' },

  // shift handover
  handoverTitle: { en: 'SHIFT HANDOVER', hi: 'शिफ्ट हैंडओवर', kn: 'ಶಿಫ್ಟ್ ಹಸ್ತಾಂತರ' },
  handoverPrompt: { en: 'Anything for the next guard?', hi: 'अगले गार्ड के लिए कुछ?', kn: 'ಮುಂದಿನ ಗಾರ್ಡ್‌ಗೆ ಏನಾದರೂ?' },
  handoverNote: { en: 'Handover note', hi: 'हैंडओवर नोट', kn: 'ಹಸ್ತಾಂತರ ಟಿಪ್ಪಣಿ' },
  fromPrevGuard: { en: 'From the previous guard', hi: 'पिछले गार्ड से', kn: 'ಹಿಂದಿನ ಗಾರ್ಡ್‌ನಿಂದ' },
  endShiftSubmit: { en: 'End shift', hi: 'शिफ्ट समाप्त करें', kn: 'ಶಿಫ್ಟ್ ಮುಗಿಸಿ' },
  skipLogout: { en: 'Skip & logout', hi: 'छोड़ें और लॉगआउट', kn: 'ಬಿಟ್ಟು ಲಾಗ್ ಔಟ್' },
  openItems: { en: 'Open items', hi: 'लंबित कार्य', kn: 'ಬಾಕಿ ಕೆಲಸಗಳು' },
  sosActiveCount: { en: 'SOS active', hi: 'SOS सक्रिय', kn: 'SOS ಸಕ್ರಿಯ' },
  deliveriesWaitingCount: { en: 'deliveries waiting', hi: 'डिलीवरी प्रतीक्षारत', kn: 'ಡೆಲಿವರಿ ಕಾಯುತ್ತಿದೆ' },

  // daily staff
  staffCheckin: { en: 'STAFF CHECK-IN', hi: 'स्टाफ चेक-इन', kn: 'ಸಿಬ್ಬಂದಿ ಚೆಕ್-ಇನ್' },
  checkIn: { en: 'In', hi: 'अंदर', kn: 'ಒಳಗೆ' },
  checkedIn: { en: 'In ✓', hi: 'अंदर ✓', kn: 'ಒಳಗೆ ✓' },
  noStaff: { en: 'No staff registered', hi: 'कोई स्टाफ पंजीकृत नहीं', kn: 'ಯಾವುದೇ ಸಿಬ್ಬಂದಿ ಇಲ್ಲ' },
  searchStaff: { en: 'Search staff…', hi: 'स्टाफ खोजें…', kn: 'ಸಿಬ್ಬಂದಿ ಹುಡುಕಿ…' },

  // driver facial verification
  verifyDriver: { en: 'Verify driver', hi: 'ड्राइवर सत्यापित करें', kn: 'ಚಾಲಕ ಪರಿಶೀಲಿಸಿ' },
  verifyingDriver: { en: 'Checking face…', hi: 'चेहरा जाँच रहे…', kn: 'ಮುಖ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…' },
  driverConfirmed: { en: 'Driver confirmed', hi: 'ड्राइवर सत्यापित', kn: 'ಚಾಲಕ ದೃಢೀಕರಿಸಲಾಗಿದೆ' },
  driverFlagged: { en: "Face didn't match — verify manually", hi: 'चेहरा मेल नहीं — स्वयं जाँचें', kn: 'ಮುಖ ಹೊಂದಿಕೆಯಾಗಿಲ್ಲ — ಸ್ವತಃ ಪರಿಶೀಲಿಸಿ' },
  faceCheckUnavailable: { en: 'Face check unavailable', hi: 'चेहरा जाँच अनुपलब्ध', kn: 'ಮುಖ ಪರಿಶೀಲನೆ ಲಭ್ಯವಿಲ್ಲ' },

  // tools
  gateControls: { en: 'GATE CONTROLS', hi: 'गेट नियंत्रण', kn: 'ಗೇಟ್ ನಿಯಂತ್ರಣಗಳು' },
  open: { en: 'Open', hi: 'खोलें', kn: 'ತೆರೆಯಿರಿ' },
  close: { en: 'Close', hi: 'बंद करें', kn: 'ಮುಚ್ಚಿ' },
  language: { en: 'Language', hi: 'भाषा', kn: 'ಭಾಷೆ' },
};

export function translate(key: string, lang: Lang): string {
  const entry = translations[key];
  if (!entry) return key;            // unknown key → show the key (dev signal)
  return entry[lang] || entry.en;    // missing translation → English fallback
}
