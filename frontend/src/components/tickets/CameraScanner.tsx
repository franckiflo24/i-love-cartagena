// Native stub. The web twin (CameraScanner.web.tsx) does live QR camera scanning
// via getUserMedia + BarcodeDetector/jsQR. Native camera scanning needs
// expo-camera and a new build (not an OTA), so until that ships the door uses
// the web scanner (works in the phone browser) or "Pegar código". Metro picks
// this file on iOS/Android; it renders nothing.
type Props = { onDetected: (wire: string) => void; onClose: () => void; lang?: string };

export default function CameraScanner(_props: Props): null {
  return null;
}
