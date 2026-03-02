import 'dart:convert';
import 'dart:async';
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

// --- VISUAL GUIDE PAINTER ---
class SplitLinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.6) // Translucent white
      ..strokeWidth = 3.0;

    // Draw vertical line in the exact middle
    canvas.drawLine(
      Offset(size.width / 2, 0),
      Offset(size.width / 2, size.height),
      paint,
    );
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
// ----------------------------

class GameController extends StatefulWidget {
  final List<CameraDescription> cameras;
  const GameController({super.key, required this.cameras});

  @override
  State<GameController> createState() => _GameControllerState();
}

class _GameControllerState extends State<GameController> {
  bool isConnected = false;
  IO.Socket? socket;
  CameraController? cameraController;
  MobileScannerController scannerController = MobileScannerController();
  String? currentRoomId;
  bool isProcessing = false;

  // Optimized image conversion for speed
  String convertImageToBase64(CameraImage image) {
    try {
      final int width = image.width;
      final int height = image.height;

      // Create image object from raw bytes
      var imgObj = img.Image(width: width, height: height);

      // Handle pixel conversion
      var bytes = image.planes[0].bytes;
      for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
          final int pixelColor = bytes[y * width + x];
          imgObj.setPixelRgb(x, y, pixelColor, pixelColor, pixelColor);
        }
      }

      // Rotate to correct orientation
      var rotatedImage = img.copyRotate(imgObj, angle: 270);

      // Resize heavily to reduce network payload
      var thumbnail = img.copyResize(rotatedImage, width: 320);

      // Encode as low-quality JPEG for fastest transmission
      final List<int> jpeg = img.encodeJpg(thumbnail, quality: 30);
      return base64Encode(jpeg);
    } catch (e) {
      print("Conversion Error: $e");
      return "";
    }
  }

  void setupConnection(String fullUrl) async {
    if (isConnected) return;
    print("🔗 Connecting to: $fullUrl");

    try {
      final Uri uri = Uri.parse(fullUrl);
      currentRoomId = uri.queryParameters['room'];
      final String baseUrl = "${uri.scheme}://${uri.host}:${uri.port}";

      await scannerController.stop();
      await scannerController.dispose();

      socket = IO.io(
        baseUrl,
        IO.OptionBuilder()
            .setTransports(['websocket'])
            .disableAutoConnect()
            .build(),
      );

      socket!.connect();
      socket!.onConnect((_) {
        print("✅ Connected. Joining Room: $currentRoomId");
        socket!.emit('join_room', {'room_id': currentRoomId, 'type': 'mobile'});
      });

      final frontCam = widget.cameras.firstWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );

      cameraController = CameraController(
        frontCam,
        ResolutionPreset.low, // Lowest resolution for max speed
        enableAudio: false,
      );

      await cameraController!.initialize();

      cameraController!.startImageStream((CameraImage image) {
        if (isProcessing || socket == null || !socket!.connected) return;

        isProcessing = true;

        Future.microtask(() {
          try {
            String base64Frame = convertImageToBase64(image);
            if (base64Frame.isNotEmpty) {
              socket!.emit('video_frame', {
                'image': base64Frame,
                'room_id': currentRoomId,
              });
            }
          } catch (e) {
            print("Frame Processing Error: $e");
          } finally {
            // Very small delay to throttle requests slightly
            Future.delayed(const Duration(milliseconds: 30), () {
              isProcessing = false;
            });
          }
        });
      });

      setState(() {
        isConnected = true;
      });
    } catch (e) {
      print("❌ Setup Error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    if (currentRoomId != null && !isConnected) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (currentRoomId == null) {
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

    // Camera view with overlay
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          (cameraController != null && cameraController!.value.isInitialized)
              ? CameraPreview(cameraController!)
              : const Center(child: CircularProgressIndicator()),
          
          // --- OVERLAY LINE ---
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(
                painter: SplitLinePainter(),
              ),
            ),
          ),
          // --------------------

          Positioned(
            top: 50, left: 20,
            child: Container(
              padding: const EdgeInsets.all(8),
              color: Colors.green.withOpacity(0.7),
              child: Text("ROOM: $currentRoomId"),
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