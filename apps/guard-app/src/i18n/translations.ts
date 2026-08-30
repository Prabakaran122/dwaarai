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
  emergency: { en: 'EMERGENCY', hi: 'आपातकाल', kn: 'ತುರ್ತು' },
  evacuate: { en: 'Evacuate', hi: 'निकासी', kn: 'ಸ್ಥಳಾಂತರ' },
  restore: { en: 'Restore', hi: 'पुनर्स्थापित', kn: 'ಮರುಸ್ಥಾಪಿಸಿ' },
  evacuateConfirm: { en: 'Hold the barrier fully open for evacuation?', hi: 'निकासी के लिए बैरियर को पूरा खुला रखें?', kn: 'ಸ್ಥಳಾಂತರಕ್ಕಾಗಿ ಬ್ಯಾರಿಯರ್ ಅನ್ನು ಸಂಪೂರ್ಣ ತೆರೆದಿಡಬೇಕೆ?' },
  restoreConfirm: { en: 'Return the barrier to normal controlled mode?', hi: 'बैरियर को सामान्य नियंत्रित मोड में लौटाएं?', kn: 'ಬ್ಯಾರಿಯರ್ ಅನ್ನು ಸಾಮಾನ್ಯ ನಿಯಂತ್ರಿತ ಮೋಡ್‌ಗೆ ಹಿಂತಿರುಗಿಸಬೇಕೆ?' },

  // Nazar bottom nav (NAZ-009)
  navGate: { en: 'Gate', hi: 'गेट', kn: 'ಗೇಟ್' },
  navVisitors: { en: 'Visitors', hi: 'आगंतुक', kn: 'ಭೇಟಿದಾರರು' },
  navParcels: { en: 'Parcels', hi: 'पार्सल', kn: 'ಪಾರ್ಸೆಲ್‌ಗಳು' },
  navIncident: { en: 'Incident', hi: 'घटना', kn: 'ಘಟನೆ' },

  // Nazar gate home — quick actions grid (NAZ-006)
  quickNewVisitor: { en: 'New visitor', hi: 'नया आगंतुक', kn: 'ಹೊಸ ಭೇಟಿದಾರ' },
  quickVehicleEntry: { en: 'Vehicle entry', hi: 'वाहन प्रवेश', kn: 'ವಾಹನ ಪ್ರವೇಶ' },
  quickDelivery: { en: 'Delivery', hi: 'डिलीवरी', kn: 'ಡೆಲಿವರಿ' },
  quickIncident: { en: 'Incident', hi: 'घटना', kn: 'ಘಟನೆ' },

  // Nazar gate home — smart alert banner (NAZ-004)
  vehicleApproaching: { en: 'Vehicle approaching', hi: 'वाहन आ रहा है', kn: 'ವಾಹನ ಸಮೀಪಿಸುತ್ತಿದೆ' },

  // Nazar — unbuilt tab placeholder
  comingInThisRedesign: { en: 'Coming in this redesign', hi: 'इस नए डिज़ाइन में जल्द आ रहा है', kn: 'ಈ ಮರುವಿನ್ಯಾಸದಲ್ಲಿ ಶೀಘ್ರದಲ್ಲಿ ಬರಲಿದೆ' },

  // New vehicle entry intake (NAZ-019..029)
  plateNotFoundWarning: { en: 'Plate not found in registry — do not allow entry without logging', hi: 'प्लेट रजिस्ट्री में नहीं मिली — बिना दर्ज किए प्रवेश न दें', kn: 'ಪ್ಲೇಟ್ ನೋಂದಣಿಯಲ್ಲಿ ಕಂಡುಬಂದಿಲ್ಲ — ದಾಖಲಿಸದೆ ಪ್ರವೇಶ ನೀಡಬೇಡಿ' },
  plateNumber: { en: 'Plate number', hi: 'प्लेट नंबर', kn: 'ಪ್ಲೇಟ್ ಸಂಖ್ಯೆ' },
  vehicleType: { en: 'Vehicle type', hi: 'वाहन प्रकार', kn: 'ವಾಹನ ಪ್ರಕಾರ' },
  vehicleTypeCar: { en: 'Car/SUV', hi: 'कार/एसयूवी', kn: 'ಕಾರ್/ಎಸ್‌ಯುವಿ' },
  vehicleTypeTwoWheeler: { en: 'Two-wheeler', hi: 'दोपहिया', kn: 'ದ್ವಿಚಕ್ರ ವಾಹನ' },
  vehicleTypeGoods: { en: 'Goods vehicle', hi: 'माल वाहन', kn: 'ಸರಕು ವಾಹನ' },
  vehicleTypeOther: { en: 'Other', hi: 'अन्य', kn: 'ಇತರೆ' },
  purposeOfVisit: { en: 'Purpose of visit', hi: 'यात्रा का उद्देश्य', kn: 'ಭೇಟಿಯ ಉದ್ದೇಶ' },
  purposeDelivery: { en: 'Delivery', hi: 'डिलीवरी', kn: 'ಡೆಲಿವರಿ' },
  purposeGuestVisit: { en: 'Guest visit', hi: 'अतिथि यात्रा', kn: 'ಅತಿಥಿ ಭೇಟಿ' },
  purposeService: { en: 'Service', hi: 'सेवा', kn: 'ಸೇವೆ' },
  purposeContractor: { en: 'Contractor', hi: 'ठेकेदार', kn: 'ಗುತ್ತಿಗೆದಾರ' },
  purposeOther: { en: 'Other', hi: 'अन्य', kn: 'ಇತರೆ' },
  takePhoto: { en: 'Take photo', hi: 'फ़ोटो लें', kn: 'ಫೋಟೋ ತೆಗೆಯಿರಿ' },
  retakePhoto: { en: 'Retake photo', hi: 'फिर से फ़ोटो लें', kn: 'ಮತ್ತೆ ಫೋಟೋ ತೆಗೆಯಿರಿ' },
  next: { en: 'Next', hi: 'आगे', kn: 'ಮುಂದೆ' },
  back: { en: 'Back', hi: 'पीछे', kn: 'ಹಿಂದೆ' },
  searchUnitPlaceholder: { en: 'Search unit number or resident name', hi: 'यूनिट नंबर या निवासी का नाम खोजें', kn: 'ಯೂನಿಟ್ ಸಂಖ್ಯೆ ಅಥವಾ ನಿವಾಸಿಯ ಹೆಸರು ಹುಡುಕಿ' },
  noUnitsFound: { en: 'No matching units', hi: 'कोई मिलती यूनिट नहीं', kn: 'ಹೊಂದಾಣಿಕೆಯ ಯೂನಿಟ್ ಇಲ್ಲ' },
  sendForApproval: { en: 'Send for approval', hi: 'स्वीकृति हेतु भेजें', kn: 'ಅನುಮೋದನೆಗೆ ಕಳುಹಿಸಿ' },
  awaitingApproval: { en: 'Awaiting resident approval', hi: 'निवासी की स्वीकृति की प्रतीक्षा', kn: 'ನಿವಾಸಿಯ ಅನುಮೋದನೆಗಾಗಿ ಕಾಯಲಾಗುತ್ತಿದೆ' },
  residentApproved: { en: 'Resident approved', hi: 'निवासी ने स्वीकृत किया', kn: 'ನಿವಾಸಿ ಅನುಮೋದಿಸಿದ್ದಾರೆ' },
  residentDenied: { en: 'Resident denied', hi: 'निवासी ने अस्वीकृत किया', kn: 'ನಿವಾಸಿ ನಿರಾಕರಿಸಿದ್ದಾರೆ' },
  noResponseCallResident: { en: 'No response — call the resident directly', hi: 'कोई प्रतिक्रिया नहीं — निवासी को सीधे कॉल करें', kn: 'ಪ್ರತಿಕ್ರಿಯೆ ಇಲ್ಲ — ನಿವಾಸಿಗೆ ನೇರವಾಗಿ ಕರೆ ಮಾಡಿ' },
  callResident: { en: 'Call resident', hi: 'निवासी को कॉल करें', kn: 'ನಿವಾಸಿಗೆ ಕರೆ ಮಾಡಿ' },
  allowEntry: { en: 'Allow entry', hi: 'प्रवेश की अनुमति दें', kn: 'ಪ್ರವೇಶ ಅನುಮತಿಸಿ' },
  holdVehicle: { en: 'Hold vehicle', hi: 'वाहन रोकें', kn: 'ವಾಹನ ತಡೆಹಿಡಿಯಿರಿ' },

  // Walk-in visitor intake (NAZ-030..043)
  visitorMobile: { en: 'Visitor mobile number', hi: 'आगंतुक का मोबाइल नंबर', kn: 'ಭೇಟಿದಾರರ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ' },
  idType: { en: 'ID type', hi: 'पहचान पत्र का प्रकार', kn: 'ಗುರುತಿನ ಪ್ರಕಾರ' },
  idAadhaar: { en: 'Aadhaar', hi: 'आधार', kn: 'ಆಧಾರ್' },
  idDrivingLicense: { en: 'Driving licence', hi: 'ड्राइविंग लाइसेंस', kn: 'ಚಾಲನಾ ಪರವಾನಗಿ' },
  idVoterId: { en: 'Voter ID', hi: 'मतदाता पहचान पत्र', kn: 'ಮತದಾರ ಗುರುತಿನ ಚೀಟಿ' },
  idOther: { en: 'Other', hi: 'अन्य', kn: 'ಇತರೆ' },
  takeIdPhoto: { en: 'Take ID photo', hi: 'पहचान पत्र की फ़ोटो लें', kn: 'ಗುರುತಿನ ಫೋಟೋ ತೆಗೆಯಿರಿ' },
  retakeIdPhoto: { en: 'Retake ID photo', hi: 'पहचान पत्र की फ़ोटो फिर से लें', kn: 'ಗುರುತಿನ ಫೋಟೋ ಮತ್ತೆ ತೆಗೆಯಿರಿ' },
  takeFacePhoto: { en: 'Take face photo', hi: 'चेहरे की फ़ोटो लें', kn: 'ಮುಖದ ಫೋಟೋ ತೆಗೆಯಿರಿ' },
  retakeFacePhoto: { en: 'Retake face photo', hi: 'चेहरे की फ़ोटो फिर से लें', kn: 'ಮುಖದ ಫೋಟೋ ಮತ್ತೆ ತೆಗೆಯಿರಿ' },
  vehiclePlateOptional: { en: 'Vehicle number (if any)', hi: 'वाहन नंबर (यदि हो)', kn: 'ವಾಹನ ಸಂಖ್ಯೆ (ಇದ್ದರೆ)' },
  holdVisitor: { en: 'Hold visitor', hi: 'आगंतुक को रोकें', kn: 'ಭೇಟಿದಾರರನ್ನು ತಡೆಹಿಡಿಯಿರಿ' },
  visitorPassIssued: { en: 'Entry pass issued', hi: 'प्रवेश पास जारी', kn: 'ಪ್ರವೇಶ ಪಾಸ್ ನೀಡಲಾಗಿದೆ' },
  passValidUntil: { en: 'Valid until', hi: 'तक मान्य', kn: 'ವರೆಗೆ ಮಾನ್ಯ' },
  relayCodeToVisitor: { en: 'SMS delivery is not yet configured — read this code to the visitor', hi: 'SMS सेवा अभी सेट नहीं है — यह कोड आगंतुक को बताएं', kn: 'SMS ಸೇವೆ ಇನ್ನೂ ಹೊಂದಿಸಿಲ್ಲ — ಈ ಕೋಡ್ ಅನ್ನು ಭೇಟಿದಾರರಿಗೆ ತಿಳಿಸಿ' },

  // Delivery overstay (NAZ-045)
  overstayed: { en: 'Overstayed', hi: 'अधिक समय से रुका', kn: 'ಹೆಚ್ಚು ಸಮಯ ಕಾದಿದೆ' },

  // Incident reporting (NAZ-056..061)
  incSpeeding: { en: 'Speeding vehicle', hi: 'तेज़ रफ़्तार वाहन', kn: 'ವೇಗದ ವಾಹನ' },
  incUnauthorizedEntry: { en: 'Unauthorized entry', hi: 'अनधिकृत प्रवेश', kn: 'ಅನಧಿಕೃತ ಪ್ರವೇಶ' },
  incTheftAttempt: { en: 'Theft attempt', hi: 'चोरी का प्रयास', kn: 'ಕಳ್ಳತನದ ಪ್ರಯತ್ನ' },
  incMedicalEmergency: { en: 'Medical emergency', hi: 'चिकित्सा आपातकाल', kn: 'ವೈದ್ಯಕೀಯ ತುರ್ತುಸ್ಥಿತಿ' },
  incFight: { en: 'Fight', hi: 'झगड़ा', kn: 'ಜಗಳ' },
  incPropertyDamage: { en: 'Property damage', hi: 'संपत्ति को नुकसान', kn: 'ಆಸ್ತಿ ಹಾನಿ' },
  detailsMinLength: { en: 'Details must be at least 20 characters', hi: 'विवरण कम से कम 20 अक्षर का होना चाहिए', kn: 'ವಿವರಗಳು ಕನಿಷ್ಠ 20 ಅಕ್ಷರಗಳಿರಬೇಕು' },
  recordVoiceNote: { en: 'Record voice note', hi: 'आवाज़ रिकॉर्ड करें', kn: 'ಧ್ವನಿ ಟಿಪ್ಪಣಿ ರೆಕಾರ್ಡ್ ಮಾಡಿ' },
  stopRecording: { en: 'Stop recording', hi: 'रिकॉर्डिंग रोकें', kn: 'ರೆಕಾರ್ಡಿಂಗ್ ನಿಲ್ಲಿಸಿ' },
  transcriptionPending: { en: 'Voice recording attached — transcription vendor not yet selected, please type or edit the details below', hi: 'आवाज़ रिकॉर्डिंग जोड़ी गई — ट्रांसक्रिप्शन सेवा अभी तय नहीं — कृपया नीचे विवरण टाइप करें', kn: 'ಧ್ವನಿ ರೆಕಾರ್ಡಿಂಗ್ ಲಗತ್ತಿಸಲಾಗಿದೆ — ಪ್ರತಿಲಿಪಿ ಸೇವೆ ಇನ್ನೂ ನಿರ್ಧರಿತವಾಗಿಲ್ಲ — ದಯವಿಟ್ಟು ಕೆಳಗೆ ವಿವರ ಬರೆಯಿರಿ' },
  submitIncident: { en: 'Submit incident', hi: 'घटना सबमिट करें', kn: 'ಘಟನೆ ಸಲ್ಲಿಸಿ' },
  // Valet (Sarthi) — ported from the standalone valet prototype.
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
};

export function translate(key: string, lang: Lang): string {
  const entry = translations[key];
  if (!entry) return key;            // unknown key → show the key (dev signal)
  return entry[lang] || entry.en;    // missing translation → English fallback
}
