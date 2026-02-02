import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:image/image.dart' as img;

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final cameras = await availableCameras();
  runApp(
    MaterialApp(
      home: GameController(
        camera: cameras.firstWhere(
          (c) => c.lensDirection == CameraLensDirection.front,
        ),
      ),
    ),
  );
}

class GameController extends StatefulWidget {
  final CameraDescription camera;
  const GameController({Key? key, required this.camera}) : super(key: key);

  @override
  _GameControllerState createState() => _GameControllerState();
}

class _GameControllerState extends State<GameController> {
  late CameraController _controller;
  late IO.Socket socket;
  bool isProcessing = false;
  bool isConnected = false;

  @override
  void initState() {
    super.initState();
    initSocket();
    initCamera();
  }

  void initSocket() {
    // REPLACE WITH YOUR IP ADDRESS
    socket = IO.io(
      'http://10.0.0.1:5000',
      IO.OptionBuilder().setTransports(['websocket']).build(),
    );

    socket.onConnect((_) {
      setState(() => isConnected = true);
      print('Connected to Server');
    });

    socket.onDisconnect((_) => setState(() => isConnected = false));
  }

  void initCamera() {
    _controller = CameraController(
      widget.camera,
      ResolutionPreset.low,
      enableAudio: false,
    );
    _controller.initialize().then((_) {
      if (!mounted) return;

      _controller.startImageStream((CameraImage image) {
        if (!isConnected || isProcessing) return;
        processAndSend(image);
      });
      setState(() {});
    });
  }

  // This is the heavy lifter
  void processAndSend(CameraImage image) async {
    isProcessing = true;

    try {
      // 1. Convert CameraImage (YUV420) to RGB
      final int width = image.width;
      final int height = image.height;
      final img.Image convertedImage = img.Image(width: width, height: height);

      // Simple pixel copy (Note: This is the bottleneck)
      for (int x = 0; x < width; x++) {
        for (int y = 0; y < height; y++) {
          final pixel = image.planes[0].bytes[y * width + x];
          convertedImage.setPixelRgba(x, y, pixel, pixel, pixel, 255);
        }
      }

      // 2. Resize to be VERY small (120px wide) to save bandwidth
      img.Image smallerImage = img.copyResize(convertedImage, width: 120);

      // 3. Compress to JPG and Base64 encode
      List<int> jpg = img.encodeJpg(smallerImage, quality: 50);
      String base64Image = base64Encode(jpg);

      // 4. Send to Python
      socket.emit('video_frame', {'image': base64Image});
    } catch (e) {
      print("Error processing frame: $e");
    }

    // Artificial delay to prevent flooding the network (aiming for ~10 FPS)
    await Future.delayed(Duration(milliseconds: 100));
    isProcessing = false;
  }

  @override
  Widget build(BuildContext context) {
    if (!_controller.value.isInitialized) return Container();
    return Scaffold(
      body: Stack(
        children: [
          CameraPreview(_controller),
          Positioned(
            top: 50,
            left: 20,
            child: CircleAvatar(
              backgroundColor: isConnected ? Colors.green : Colors.red,
              radius: 10,
            ),
          ),
          Center(
            child: Text(
              "Controller Mode",
              style: TextStyle(color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    socket.dispose();
    super.dispose();
  }
}
