import 'dart:convert';
import 'dart:async';
import 'dart:typed_data';
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
      ..color = Colors.white.withOpacity(0.6)
      ..strokeWidth = 3.0;

    canvas.drawLine(
      Offset(size.width / 2, 0),
      Offset(size.width / 2, size.height),
      paint,
    );
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}

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

  // Optimized image conversion for speed and stability
  String convertImageToBase64(CameraImage image) {
    final stopwatch = Stopwatch()..start();
    try {
      final Uint8List planeBytes = image.planes[0].bytes;
      final int width = image.width;
      final int height = image.height;

      // 1. Create the container (1-channel for Greyscale)
      var imgObj = img.Image(width: width, height: height, numChannels: 1);

      // 2. THE STABLE MANUAL FILL
      // We get an iterator that points to the first pixel and move through the image.
      int byteIndex = 0;
      for (final pixel in imgObj) {
        if (byteIndex < planeBytes.length) {
          // Set the current pixel to the brightness value from the camera
          pixel.setRgba(
            planeBytes[byteIndex],
            planeBytes[byteIndex],
            planeBytes[byteIndex],
            255,
          );
          byteIndex++;
        }
      }

      // 3. Resize (Still sending landscape/sideways to save phone CPU)
      var thumbnail = img.copyResize(
        imgObj,
        width: 280,
        interpolation: img.Interpolation.nearest,
      );

      // 4. Encode to JPEG
      final List<int> jpeg = img.encodeJpg(thumbnail, quality: 25);

      print("⏱️ Image conversion took: ${stopwatch.elapsedMilliseconds}ms");
      return base64Encode(jpeg);
    } catch (e) {
      print("❌ Conversion Error: $e");
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

      // Confirm join success
      socket!.on(
        'joined',
        (data) => print("🎉 Successfully joined room $currentRoomId"),
      );

      final frontCam = widget.cameras.firstWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );

      cameraController = CameraController(
        frontCam,
        ResolutionPreset.low,
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
                'room_id': currentRoomId.toString(),
              });
            }
          } catch (e) {
            print("Frame Processing Error: $e");
          } finally {
            // Throttle to roughly 20 FPS (50ms delay)
            Future.delayed(const Duration(milliseconds: 50), () {
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
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
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

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          (cameraController != null && cameraController!.value.isInitialized)
              ? CameraPreview(cameraController!)
              : const Center(child: CircularProgressIndicator()),

          if (currentRoomId != null &&
              int.tryParse(currentRoomId!) != null &&
              int.parse(currentRoomId!) % 2 == 0)
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(painter: SplitLinePainter()),
              ),
            ),

          Positioned(
            top: 50,
            left: 20,
            child: Container(
              padding: const EdgeInsets.all(8),
              color: Colors.green.withOpacity(0.7),
              child: Text(
                "ROOM: $currentRoomId (${int.parse(currentRoomId!) % 2 == 0 ? 'Multiplayer' : 'Singleplayer'})",
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
