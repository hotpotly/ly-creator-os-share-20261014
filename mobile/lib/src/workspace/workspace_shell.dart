import 'dart:async';
import 'package:flutter/material.dart';
import 'review_page.dart';
import 'todo_page.dart';
import 'workspace_controller.dart';
import 'workspace_store.dart';
import 'workspace_sync_panel.dart';
import '../storage/connection_store.dart';
import '../sync/workspace_sync_engine.dart';

class WorkspaceShell extends StatefulWidget {
  const WorkspaceShell({
    super.key,
    required this.captureBuilder,
    required this.destination,
    this.store,
    this.connections,
    this.onConnect,
    this.active = true,
  });
  final WidgetBuilder captureBuilder;
  final ValueNotifier<int> destination;
  final WorkspaceStore? store;
  final ConnectionStore? connections;
  final Future<void> Function()? onConnect;
  final bool active;
  @override
  State<WorkspaceShell> createState() => WorkspaceShellState();
}

class WorkspaceShellState extends State<WorkspaceShell> {
  WorkspaceSyncEngine? sync;
  bool _foreground =
      WidgetsBinding.instance.lifecycleState == null ||
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
  void requestSync() => sync?.requestSync();
  void setForeground(bool value) {
    _foreground = value;
    sync?.setActive(value && widget.active);
  }

  @override
  void didUpdateWidget(covariant WorkspaceShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active != oldWidget.active) {
      sync?.setActive(widget.active && _foreground);
    }
  }

  WorkspaceController? controller;
  String? error;
  bool opening = false;
  @override
  void initState() {
    super.initState();
    open();
  }

  Future<void> open() async {
    if (opening) return;
    setState(() {
      opening = true;
      error = null;
    });
    try {
      final store = widget.store ?? await SqliteWorkspaceStore.create();
      if (!mounted) {
        if (widget.store == null) await store.close();
        return;
      }
      final next = WorkspaceController(store);
      await next.load();
      if (!mounted) {
        next.dispose();
        if (widget.store == null) await store.close();
        return;
      }
      if (!next.loaded) {
        next.dispose();
        if (widget.store == null) await store.close();
        throw StateError('load failed');
      }
      if (store is WorkspaceSyncStore && widget.connections != null) {
        final engine = WorkspaceSyncEngine(
          store: store as WorkspaceSyncStore,
          controller: next,
          connections: widget.connections!,
        );
        sync = engine;
        next.onLocalChanged = engine.localChanged;
        await engine.refresh();
        if (!mounted) {
          engine.dispose();
          next.dispose();
          if (widget.store == null) await store.close();
          return;
        }
        engine.setActive(widget.active && _foreground);
      }
      setState(() => controller = next);
    } catch (_) {
      if (mounted) setState(() => error = '本地工作区无法打开，原始数据已保留');
    } finally {
      if (mounted) setState(() => opening = false);
    }
  }

  @override
  void dispose() {
    final value = controller;
    sync?.dispose();
    value?.dispose();
    if (widget.store == null && value != null) {
      Future.wait([
        value.settled,
        sync?.settled ?? Future<void>.value(),
      ]).then((_) => value.store.close());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<int>(
    valueListenable: widget.destination,
    builder: (context, selected, _) => Scaffold(
      body: IndexedStack(
        index: selected,
        children: [
          _workspace(
            child: controller == null
                ? null
                : TodoPage(controller: controller!),
          ),
          _workspace(
            child: controller == null
                ? null
                : ReviewPage(controller: controller!),
          ),
          widget.captureBuilder(context),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: selected,
        onDestinationSelected: (index) {
          FocusManager.instance.primaryFocus?.unfocus();
          widget.destination.value = index;
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.check_circle_outline),
            selectedIcon: Icon(Icons.check_circle),
            label: '待办',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_view_week_outlined),
            label: '计划与复盘',
          ),
          NavigationDestination(
            icon: Icon(Icons.lightbulb_outline),
            selectedIcon: Icon(Icons.lightbulb),
            label: '灵感采集',
          ),
        ],
      ),
    ),
  );
  Widget _workspace({Widget? child}) => SafeArea(
    child: child == null
        ? Center(
            child: error == null
                ? const CircularProgressIndicator()
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(error!),
                      TextButton(onPressed: open, child: const Text('重试')),
                    ],
                  ),
          )
        : Column(
            children: [
              if (sync != null)
                AnimatedBuilder(
                  animation: sync!,
                  builder: (context, _) => Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () => showModalBottomSheet<void>(
                        context: context,
                        useSafeArea: true,
                        isScrollControlled: true,
                        builder: (_) => ConstrainedBox(
                          constraints: BoxConstraints(
                            maxHeight: MediaQuery.sizeOf(context).height * .8,
                          ),
                          child: WorkspaceSyncPanel(
                            engine: sync!,
                            onConnect: widget.onConnect ?? () async {},
                            allowFullUpgrade: true,
                          ),
                        ),
                      ),
                      icon: Icon(
                        sync!.error != null || sync!.conflicts.isNotEmpty
                            ? Icons.sync_problem
                            : Icons.sync,
                        size: 16,
                      ),
                      label: Text(
                        sync!.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                ),
              Expanded(child: child),
            ],
          ),
  );
}
