import 'dart:async';

import 'package:flutter/material.dart';

import 'src/app.dart';
import 'src/intake/share_intake.dart';
import 'src/storage/secure_connection_store.dart';
import 'src/storage/sqlite_capture_store.dart';
import 'src/sync/background_sync.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _CreatorCaptureBootstrap());
}

class _CreatorCaptureBootstrap extends StatefulWidget {
  const _CreatorCaptureBootstrap();

  @override
  State<_CreatorCaptureBootstrap> createState() =>
      _CreatorCaptureBootstrapState();
}

class _CreatorCaptureBootstrapState extends State<_CreatorCaptureBootstrap> {
  late Future<SqliteCaptureStore> store = _openStore();

  Future<SqliteCaptureStore> _openStore() async {
    final openedStore = await SqliteCaptureStore.create();
    unawaited(
      initializeBackgroundSync().catchError((_) {
        // Foreground saving and retry remain available even if the OEM
        // temporarily refuses background task registration.
      }),
    );
    return openedStore;
  }

  void retry() {
    setState(() => store = _openStore());
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<SqliteCaptureStore>(
      future: store,
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          return CreatorCaptureApp(
            captureStore: snapshot.requireData,
            connectionStore: const SecureConnectionStore(),
            attachmentIntake: NativeShareIntake(),
          );
        }
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          title: 'LY快速记录',
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xff6f805d),
              surface: const Color(0xfffaf8f3),
            ),
          ),
          home: Scaffold(
            body: SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: snapshot.hasError
                      ? Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Text(
                              '本地资料暂时无法打开',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 10),
                            const Text('记录没有被删除，请重试。'),
                            const SizedBox(height: 18),
                            FilledButton(
                              onPressed: retry,
                              child: const Text('重新打开'),
                            ),
                          ],
                        )
                      : const Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator(),
                            SizedBox(height: 16),
                            Text('正在准备本地资料…'),
                          ],
                        ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
