import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class PullToAdd extends StatefulWidget {
  const PullToAdd({
    super.key,
    required this.child,
    required this.onAdd,
    this.enabled = true,
  });
  final Widget child;
  final Future<void> Function() onAdd;
  final bool enabled;
  @override
  State<PullToAdd> createState() => _PullToAddState();
}

class _PullToAddState extends State<PullToAdd> {
  double distance = 0;
  bool busy = false;
  bool cancelled = false;
  bool signalled = false;
  static const threshold = 64.0;

  @override
  void didUpdateWidget(covariant PullToAdd oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled) {
      distance = 0;
      cancelled = true;
      signalled = false;
    }
  }

  void update(double value) {
    final next = value.clamp(0.0, 100.0);
    if (next >= threshold && !signalled) {
      signalled = true;
      HapticFeedback.selectionClick();
    }
    if (next != distance) setState(() => distance = next);
  }

  Future<void> release() async {
    final shouldOpen =
        widget.enabled && !busy && !cancelled && distance >= threshold;
    update(0);
    signalled = false;
    if (!shouldOpen) return;
    busy = true;
    try {
      await widget.onAdd();
    } finally {
      busy = false;
    }
  }

  bool onScroll(ScrollNotification notification) {
    if (!widget.enabled ||
        busy ||
        notification.depth != 0 ||
        notification.metrics.axis != Axis.vertical) {
      return false;
    }
    if (notification is OverscrollNotification &&
        notification.dragDetails != null &&
        notification.metrics.pixels <= notification.metrics.minScrollExtent &&
        notification.overscroll < 0) {
      update(distance - notification.overscroll * .6);
    } else if (notification is ScrollUpdateNotification &&
        notification.dragDetails != null &&
        (notification.scrollDelta ?? 0) > 0) {
      update(distance - notification.scrollDelta!);
    } else if (notification is OverscrollNotification &&
        notification.dragDetails != null &&
        notification.overscroll > 0) {
      update(distance - notification.overscroll);
    } else if (notification is ScrollEndNotification) {
      unawaited(Future.microtask(release));
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    final theme = Theme.of(context);
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Listener(
      onPointerDown: (_) {
        cancelled = false;
      },
      onPointerCancel: (_) {
        cancelled = true;
        update(0);
      },
      child: NotificationListener<ScrollNotification>(
        onNotification: onScroll,
        child: ClipRect(
          child: Stack(
            children: [
              if (distance > 0)
                Positioned(
                  top: 8,
                  left: 0,
                  right: 0,
                  child: IgnorePointer(
                    child: Center(
                      child: Semantics(
                        liveRegion: true,
                        label: distance >= threshold ? '松开新增' : '下拉新增',
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            AnimatedRotation(
                              turns: distance >= threshold ? .5 : 0,
                              duration: reduced
                                  ? Duration.zero
                                  : const Duration(milliseconds: 160),
                              child: Icon(
                                distance >= threshold
                                    ? Icons.add
                                    : Icons.arrow_downward,
                                color: theme.colorScheme.primary,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              distance >= threshold ? '松开新增' : '下拉新增',
                              style: TextStyle(
                                color: theme.colorScheme.primary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              AnimatedContainer(
                duration: distance == 0 && !reduced
                    ? const Duration(milliseconds: 180)
                    : Duration.zero,
                curve: Curves.easeOutCubic,
                transform: Matrix4.translationValues(0, distance, 0),
                child: widget.child,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
