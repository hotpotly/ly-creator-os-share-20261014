import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum RecordingState { idle, recording, paused, finalizing }

class RecordingSnapshot {
  const RecordingSnapshot({
    required this.state,
    required this.durationMs,
    required this.markersMs,
  });

  final RecordingState state;
  final int durationMs;
  final List<int> markersMs;

  factory RecordingSnapshot.fromMap(Map<Object?, Object?>? value) {
    final stateName = value?['state'] as String? ?? 'idle';
    return RecordingSnapshot(
      state: RecordingState.values.firstWhere(
        (item) => item.name == stateName,
        orElse: () => RecordingState.idle,
      ),
      durationMs: (value?['durationMs'] as num?)?.toInt() ?? 0,
      markersMs:
          (value?['markersMs'] as List?)
              ?.whereType<num>()
              .map((item) => item.toInt())
              .toList() ??
          const [],
    );
  }
}

class RecordingController extends ChangeNotifier {
  RecordingController();

  static const _channel = MethodChannel('ly.creator.capture/recording');
  RecordingSnapshot _snapshot = const RecordingSnapshot(
    state: RecordingState.idle,
    durationMs: 0,
    markersMs: [],
  );
  Timer? _timer;
  String? _error;

  RecordingSnapshot get snapshot => _snapshot;
  String? get error => _error;

  Future<void> refresh() async {
    try {
      _snapshot = RecordingSnapshot.fromMap(
        await _channel.invokeMapMethod<Object?, Object?>('getState'),
      );
      _error = null;
      if (_snapshot.state == RecordingState.idle) {
        _timer?.cancel();
        _timer = null;
      } else {
        _timer ??= Timer.periodic(
          const Duration(seconds: 1),
          (_) => unawaited(refresh()),
        );
      }
      notifyListeners();
    } catch (error) {
      _error = error.toString();
      notifyListeners();
    }
  }

  Future<void> start() => _command('start');
  Future<void> pause() => _command('pause');
  Future<void> resume() => _command('resume');
  Future<void> mark() => _command('mark');
  Future<void> stop() => _command('stop');
  Future<void> discard() => _command('discard');

  Future<void> _command(String method) async {
    try {
      await _channel.invokeMethod<void>(method);
      await Future<void>.delayed(const Duration(milliseconds: 180));
      await refresh();
    } on PlatformException catch (error) {
      _error = error.message ?? error.code;
      notifyListeners();
      rethrow;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
