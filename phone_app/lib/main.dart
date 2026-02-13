import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:image/image.dart' as img;

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final cameras = await availableCameras();
  runApp(
    MaterialApp(
      theme: ThemeData.dark(),
      home: GameController(cameras: cameras),
    ),
  );
}

class GameController extends StatefulWidget {
  final List<CameraDescription> cameras;
  const GameController({super.key, required this.cameras});

  @override
  State<GameController> createState() => _GameControllerState();
}

class _GameControllerState extends State<GameController> {
  // Logic & Connection State
  bool isConnected = false;
  IO.Socket? socket;
  CameraController? cameraController;
  final MobileScannerController scannerController = MobileScannerController();

  bool isProcessing = false; // Prevents overwhelming the server

  // 1. THE CONVERSION HELPER (Fixes the "Tiny String" error)
  String convertImageToBase64(CameraImage image) {
  try {
    final int width = image.width;
    final int height = image.height;

    // Create a new image buffer
    var imgObj = img.Image(width: width, height: height);

    // This loop manually fills the image with the 'Y' (brightness) plane
    // It's a grayscale shortcut that is EXTREMELY fast and works perfectly for AI
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        final int pixelColor = image.planes[0].bytes[y * width + x];
        // Set pixel as grayscale (R=G=B)
        imgObj.setPixelRgb(x, y, pixelColor, pixelColor, pixelColor);
      }
    }

    // Resize to 160px width to make it tiny and fast for the network
    var thumbnail = img.copyResize(imgObj, width: 160);

    // Encode as JPEG
    final List<int> jpeg = img.encodeJpg(thumbnail, quality: 40);
    return base64Encode(jpeg);
  } catch (e) {
    print("Conversion Error: $e");
    return "";
  }
}
  // 2. THE HANDSHAKE (Switch from Scanner to Game Camera)
  void setupConnection(String url) async {
    print("🔗 Connecting to: $url");

    try {
      // Stop the QR Scanner immediately
      await scannerController.stop();

      // Initialize Socket.io
      socket = IO.io(
        url,
        IO.OptionBuilder().setTransports(['websocket']).build(),
      );

      socket!.connect();

      // Initialize Front Camera
      final frontCam = widget.cameras.firstWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );

      cameraController = CameraController(
        frontCam,
        ResolutionPreset.low,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg, // Helps with compatibility
      );

      await cameraController!.initialize();

      setState(() {
        isConnected = true;
      });

      // 3. THE STREAMING LOOP
      cameraController!.startImageStream((CameraImage image) {
        if (!isProcessing && socket != null && socket!.connected) {
          isProcessing = true;

          String base64Frame = convertImageToBase64(image);

          if (base64Frame.isNotEmpty) {
            socket!.emit('video_frame', {'image': base64Frame});
          }

          // Throttle to ~10 frames per second
          Future.delayed(const Duration(milliseconds: 100), () {
            isProcessing = false;
          });
        }
      });
    } catch (e) {
      print("❌ Setup Error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    // PHASE 1: SCANNING MODE
    if (!isConnected) {
      return Scaffold(
        appBar: AppBar(title: const Text("Scan Server QR")),
        body: MobileScanner(
          controller: scannerController,
          onDetect: (capture) {
            final List<Barcode> barcodes = capture.barcodes;
            if (barcodes.isNotEmpty && barcodes.first.rawValue != null) {
              setupConnection(barcodes.first.rawValue!);
            }
          },
        ),
      );
    }

    // PHASE 2: GAME MODE (Camera Feed)
    return Scaffold(
      body: Stack(
        children: [
          (cameraController != null && cameraController!.value.isInitialized)
              ? CameraPreview(cameraController!)
              : const Center(child: CircularProgressIndicator()),
          Positioned(
            top: 50,
            left: 20,
            child: Container(
              padding: const EdgeInsets.all(8),
              color: Colors.green,
              child: const Text(
                "STREAMING TO SERVER",
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    scannerController.dispose();
    cameraController?.dispose();
    socket?.dispose();
    super.dispose();
  }
}
