import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'controller/capture_queue_controller.dart';
import 'intake/share_intake.dart';
import 'maintenance/mobile_app_settings.dart';
import 'maintenance/mobile_maintenance.dart';
import 'model/capture_entry.dart';
import 'model/desktop_connection.dart';
import 'model/desktop_service.dart';
import 'recording/recording_controller.dart';
import 'sync/mobile_sync_client.dart';
import 'sync/background_sync.dart';
import 'storage/capture_store.dart';
import 'storage/connection_store.dart';
import 'workspace/workspace_shell.dart';
import 'workspace/workspace_theme.dart';
import 'workspace/workspace_store.dart';
import 'sync/sync_policy.dart';

class CreatorCaptureApp extends StatefulWidget {
  const CreatorCaptureApp({
    super.key,
    required this.captureStore,
    required this.connectionStore,
    required this.attachmentIntake,
    this.maintenance,
    this.workspaceStore,
    this.now,
  });

  final CaptureStore captureStore;
  final ConnectionStore connectionStore;
  final AttachmentIntake attachmentIntake;
  final MobileMaintenance? maintenance;
  final WorkspaceStore? workspaceStore;
  final DateTime Function()? now;

  @override
  State<CreatorCaptureApp> createState() => _CreatorCaptureAppState();
}

class _CreatorCaptureAppState extends State<CreatorCaptureApp>
    with WidgetsBindingObserver {
  late final CaptureQueueController controller;
  late final RecordingController recordingController;
  late final MobileAppSettings settings;
  final navigatorKey = GlobalKey<NavigatorState>();
  DateTime? backgroundedAt;
  bool historyUnlocked = false;
  bool settingsInitialized = false;
  final destination = ValueNotifier<int>(0);
  final captureKey = GlobalKey<_CaptureHomePageState>();
  final workspaceKey = GlobalKey<WorkspaceShellState>();
  String? pendingAction;
  String? settingsError;
  bool authenticating = false;
  late final networkEvents = ForegroundNetworkEvents(() {
    workspaceKey.currentState?.requestSync();
    if (controller.connection != null && controller.pendingCount > 0) {
      unawaited(controller.refreshDiscovery());
    }
  });
  late final routeObserver = _CaptureRouteObserver(dispatchCapture);
  bool get locked =>
      !settings.loaded || (settings.historyLockEnabled && !historyUnlocked);

  Future<void> loadSettings() async {
    setState(() => settingsError = null);
    try {
      await settings.load();
    } catch (_) {
      if (mounted) setState(() => settingsError = '隐私设置读取失败，请重试');
    }
  }

  void requestCapture([String? action]) {
    pendingAction = action ?? 'show';
    if (!locked) dispatchCapture();
  }

  void dispatchCapture() {
    if (!mounted || locked || pendingAction == null) return;
    if (navigatorKey.currentState?.canPop() ?? false) return;
    destination.value = 2;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || locked) return;
      final page = captureKey.currentState;
      if (page == null) return;
      final action = pendingAction;
      pendingAction = null;
      if (action != 'show') unawaited(page._runQuickAction(action));
    });
  }

  Future<void> unlock() async {
    if (authenticating) return;
    setState(() => authenticating = true);
    try {
      if (await controller.authenticate('打开随身工作台') && mounted) {
        setState(() => historyUnlocked = true);
        dispatchCapture();
      }
    } finally {
      if (mounted) setState(() => authenticating = false);
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    controller = CaptureQueueController(
      widget.captureStore,
      widget.connectionStore,
      attachmentIntake: widget.attachmentIntake,
      maintenance: widget.maintenance,
    )..setScreenProtection(true);
    controller.onCaptureReceived = () => requestCapture();
    controller.setQuickActionHandler(requestCapture);
    unawaited(controller.load().catchError((_) {}));
    unawaited(
      controller
          .consumeQuickAction()
          .then((action) {
            if (action != null && mounted) requestCapture(action);
          })
          .catchError((_) {}),
    );
    recordingController = RecordingController()..refresh();
    settings = MobileAppSettings()..addListener(_settingsChanged);
    unawaited(loadSettings());
    unawaited(networkEvents.start());
  }

  void _settingsChanged() {
    if (!mounted) return;
    if (!settings.loaded) return;
    unawaited(controller.setScreenProtection(settings.historyLockEnabled));
    setState(() {
      if (!settingsInitialized) {
        settingsInitialized = true;
        historyUnlocked = !settings.historyLockEnabled;
      } else if (!settings.historyLockEnabled) {
        historyUnlocked = true;
      }
    });
    dispatchCapture();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      workspaceKey.currentState?.setForeground(false);
    }
    if (state == AppLifecycleState.resumed) {
      controller.setForeground(true);
      unawaited(networkEvents.start());
      controller.importPendingShares();
      if (controller.connection != null && controller.pendingCount > 0) {
        unawaited(controller.refreshDiscovery());
      }
      final elapsed = backgroundedAt == null
          ? Duration.zero
          : (widget.now?.call() ?? DateTime.now()).difference(backgroundedAt!);
      if (settings.historyLockEnabled &&
          elapsed >= Duration(minutes: settings.historyLockMinutes)) {
        setState(() => historyUnlocked = false);
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted &&
            WidgetsBinding.instance.lifecycleState ==
                AppLifecycleState.resumed) {
          workspaceKey.currentState?.setForeground(true);
        }
      });
    } else if (state == AppLifecycleState.paused) {
      workspaceKey.currentState?.setForeground(false);
      backgroundedAt = widget.now?.call() ?? DateTime.now();
      unawaited(controller.flushDraft());
      controller.setForeground(false);
      unawaited(networkEvents.stop());
      unawaited(
        scheduleBackgroundSyncNow(
          hasPendingWork:
              controller.pendingCount > 0 &&
              controller.connection != null &&
              !controller.syncPaused,
        ).catchError((_) {}),
      );
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    controller.setQuickActionHandler(null);
    unawaited(networkEvents.stop());
    destination.dispose();
    controller.dispose();
    recordingController.dispose();
    settings.removeListener(_settingsChanged);
    settings.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      navigatorObservers: [routeObserver],
      builder: (context, child) => Stack(
        children: [
          Offstage(
            offstage: locked,
            child: ExcludeFocus(excluding: locked, child: child!),
          ),
          if (locked)
            Scaffold(
              body: Center(
                child: !settings.loaded
                    ? settingsError == null
                          ? const CircularProgressIndicator()
                          : Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(settingsError!),
                                TextButton(
                                  onPressed: loadSettings,
                                  child: const Text('重试'),
                                ),
                              ],
                            )
                    : FilledButton.icon(
                        onPressed: authenticating ? null : unlock,
                        icon: const Icon(Icons.lock_outline),
                        label: Text(authenticating ? '验证中…' : '解锁'),
                      ),
              ),
            ),
        ],
      ),
      debugShowCheckedModeBanner: false,
      title: 'LY Creator OS',
      theme: workspaceTheme(Brightness.light),
      darkTheme: workspaceTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: !settings.loaded
          ? Scaffold(
              body: Center(
                child: settingsError == null
                    ? const CircularProgressIndicator()
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(settingsError!),
                          TextButton(
                            onPressed: loadSettings,
                            child: const Text('重试'),
                          ),
                        ],
                      ),
              ),
            )
          : Stack(
              children: [
                Offstage(
                  offstage: locked,
                  child: WorkspaceShell(
                    key: workspaceKey,
                    connections: widget.connectionStore,
                    active: !locked,
                    onConnect: () async {
                      await showModalBottomSheet<void>(
                        context: navigatorKey.currentContext!,
                        isScrollControlled: true,
                        useSafeArea: true,
                        builder: (_) =>
                            _ConnectionSheet(controller: controller),
                      );
                      workspaceKey.currentState?.requestSync();
                    },
                    destination: destination,
                    store: widget.workspaceStore,
                    captureBuilder: (_) => CaptureHomePage(
                      key: captureKey,
                      active: destination.value == 2 && !locked,
                      controller: controller,
                      recordingController: recordingController,
                      settings: settings,
                      historyUnlocked: historyUnlocked,
                      onHistoryUnlocked: () =>
                          setState(() => historyUnlocked = true),
                    ),
                  ),
                ),
                if (locked)
                  Scaffold(
                    body: Center(
                      child: FilledButton.icon(
                        onPressed: authenticating ? null : unlock,
                        icon: const Icon(Icons.lock_outline),
                        label: Text(authenticating ? '验证中…' : '解锁'),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class CaptureHomePage extends StatefulWidget {
  const CaptureHomePage({
    super.key,
    required this.controller,
    required this.recordingController,
    required this.settings,
    required this.historyUnlocked,
    required this.onHistoryUnlocked,
    this.active = true,
  });

  final CaptureQueueController controller;
  final RecordingController recordingController;
  final MobileAppSettings settings;
  final bool historyUnlocked;
  final VoidCallback onHistoryUnlocked;
  final bool active;

  @override
  State<CaptureHomePage> createState() => _CaptureHomePageState();
}

class _CaptureHomePageState extends State<CaptureHomePage> {
  final textController = TextEditingController();
  final focusNode = FocusNode();
  bool saving = false;
  bool draftRestored = false;
  bool setupPrompted = false;
  String searchQuery = '';
  CaptureLibraryFilter filter = CaptureLibraryFilter.all;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_restoreDraft);
    widget.controller.addListener(_updateWidget);
    widget.recordingController.addListener(_updateWidget);
    widget.settings.addListener(_maybePromptSetup);
    _restoreDraft();
    _maybePromptSetup();
  }

  void _restoreDraft() {
    if (draftRestored || widget.controller.loading) return;
    draftRestored = true;
    if (textController.text.isEmpty &&
        widget.controller.draftContent.isNotEmpty) {
      textController.text = widget.controller.draftContent;
      textController.selection = TextSelection.collapsed(
        offset: textController.text.length,
      );
    }
  }

  void _maybePromptSetup() {
    if (!setupPrompted &&
        widget.active &&
        mounted &&
        widget.settings.loaded &&
        !widget.settings.setupComplete) {
      setupPrompted = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(showSetup());
      });
    }
  }

  void _updateWidget() {
    unawaited(
      widget.controller.updateSystemWidget(
        recording:
            widget.recordingController.snapshot.state != RecordingState.idle,
      ),
    );
  }

  @override
  void didUpdateWidget(covariant CaptureHomePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) _maybePromptSetup();
  }

  Future<void> _runQuickAction(String? action) async {
    switch (action) {
      case 'camera':
        await takePhoto();
        break;
      case 'record':
        await recordingCommand(widget.recordingController.start);
        break;
      case 'sync':
        await widget.controller.syncPending();
        break;
      case 'text':
        focusNode.requestFocus();
        break;
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_restoreDraft);
    widget.controller.removeListener(_updateWidget);
    widget.recordingController.removeListener(_updateWidget);
    widget.settings.removeListener(_maybePromptSetup);
    unawaited(widget.controller.flushDraft());
    textController.dispose();
    focusNode.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (saving || textController.text.trim().isEmpty) return;
    setState(() => saving = true);
    try {
      await widget.controller.add(textController.text, CaptureHint.auto);
      if (!mounted) return;
      textController.clear();
      focusNode.requestFocus();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.controller.connection == null
                ? '已保存在手机，等待连接Mac'
                : '已保存在手机，正在同步',
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error.toString().replaceFirst('Invalid argument(s): ', ''),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> pickAttachments() async {
    if (saving) return;
    setState(() => saving = true);
    try {
      final saved = await widget.controller.pickAttachments();
      if (!mounted || saved == null) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('文件已安全保存')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> pickMedia() async {
    if (saving) return;
    setState(() => saving = true);
    try {
      final saved = await widget.controller.pickMedia();
      if (!mounted || saved == null) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('图片或视频已安全保存')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> takePhoto() async {
    if (saving) return;
    setState(() => saving = true);
    try {
      final saved = await widget.controller.takePhoto();
      if (!mounted || saved == null) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('照片已安全保存')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> recordingCommand(Future<void> Function() command) async {
    try {
      await command();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(widget.recordingController.error ?? '录音操作失败')),
      );
    }
  }

  Future<void> confirmDiscardRecording() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('放弃这段录音？'),
        content: const Text('已经录下的内容会从手机删除，无法恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('继续录音'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认放弃'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await recordingCommand(widget.recordingController.discard);
    }
  }

  Future<void> showConnection() {
    unawaited(widget.controller.refreshDiscovery(syncAfterRefresh: false));
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _ConnectionSheet(controller: widget.controller),
    );
  }

  Future<void> showSetup() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) =>
          _SetupSheet(controller: widget.controller, settings: widget.settings),
    );
  }

  Future<void> showSettings() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _SettingsSheet(
        controller: widget.controller,
        settings: widget.settings,
        onSetup: showSetup,
        onEnableLock: () async {
          final unlocked = await widget.controller.authenticate('启用最近记录保护');
          if (unlocked) widget.onHistoryUnlocked();
          return unlocked;
        },
        ensureHistoryAccess: _ensureHistoryAccess,
      ),
    );
  }

  Future<void> showTrash() async {
    if (!await _ensureHistoryAccess()) return;
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _TrashSheet(controller: widget.controller),
    );
  }

  Future<bool> _ensureHistoryAccess() async {
    if (!widget.settings.historyLockEnabled || widget.historyUnlocked) {
      return true;
    }
    final unlocked = await widget.controller.authenticate('查看最近记录和附件');
    if (unlocked) widget.onHistoryUnlocked();
    return unlocked;
  }

  Future<void> unlockHistory() async {
    await _ensureHistoryAccess();
  }

  Future<void> showRecord(CaptureEntry entry) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (context) => _RecordActionsSheet(entry: entry),
    );
    if (!mounted || action == null) return;
    if (action.startsWith('share:')) {
      try {
        await widget.controller.shareRecord(
          entry.id,
          attachmentId: action.substring('share:'.length),
        );
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(error.toString())));
        }
      }
      return;
    }
    switch (action) {
      case 'edit':
        await editRecord(entry);
        break;
      case 'note':
        await appendNote(entry);
        break;
      case 'share':
        try {
          await widget.controller.shareRecord(entry.id);
        } catch (error) {
          if (mounted) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(SnackBar(content: Text(error.toString())));
          }
        }
        break;
      case 'delete':
        await confirmDelete(entry);
        break;
    }
  }

  Future<void> appendNote(CaptureEntry entry) async {
    final note = TextEditingController();
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('追加备注'),
          content: TextField(
            controller: note,
            autofocus: true,
            minLines: 3,
            maxLines: 8,
            maxLength: 10000,
            decoration: const InputDecoration(hintText: '补充尤其要注意的内容，不覆盖原始记录'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('追加'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      await widget.controller.appendNote(entry.id, note.text);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      note.dispose();
    }
  }

  Future<void> confirmDelete(CaptureEntry entry) async {
    final synced =
        entry.syncState == CaptureSyncState.synced && !entry.hasPendingNoteSync;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(synced ? '删除手机副本？' : '移入回收站？'),
        content: Text(
          synced
              ? '只删除手机上的这条记录和附件，Mac内容不会删除。'
              : '未同步记录会在手机回收站保留30天，Mac不会收到删除操作。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(synced ? '删除手机副本' : '移入回收站'),
          ),
        ],
      ),
    );
    if (confirmed == true) await widget.controller.deleteRecord(entry.id);
  }

  List<Widget> _historySection() {
    final visible = widget.controller.search(
      query: searchQuery,
      filter: filter,
    );
    return [
      const SizedBox(height: 26),
      Row(
        children: [
          const Text(
            '最近记录',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
          ),
          const Spacer(),
          IconButton(
            tooltip: '手机回收站',
            onPressed: showTrash,
            icon: Badge(
              isLabelVisible: widget.controller.trashedEntries.isNotEmpty,
              label: Text('${widget.controller.trashedEntries.length}'),
              child: const Icon(Icons.delete_outline_rounded, size: 20),
            ),
          ),
          Text(
            '${widget.controller.entries.length}条',
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              fontSize: 12,
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      if (!widget.settings.loaded)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(child: CircularProgressIndicator()),
        )
      else if (!widget.historyUnlocked && widget.settings.historyLockEnabled)
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
          child: Column(
            children: [
              const Icon(Icons.lock_outline_rounded, size: 28),
              const SizedBox(height: 8),
              const Text(
                '最近记录已锁定',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              const Text(
                '快速记录仍可直接使用，只有查看历史需要验证。',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: unlockHistory,
                icon: const Icon(Icons.fingerprint_rounded),
                label: const Text('解锁查看'),
              ),
            ],
          ),
        )
      else ...[
        TextField(
          key: const Key('capture-search'),
          onChanged: (value) => setState(() => searchQuery = value),
          decoration: const InputDecoration(
            hintText: '搜索标题、文字、链接、文件名或备注',
            prefixIcon: Icon(Icons.search_rounded),
            isDense: true,
          ),
        ),
        const SizedBox(height: 9),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: CaptureLibraryFilter.values.map((value) {
              final label = switch (value) {
                CaptureLibraryFilter.all => '全部',
                CaptureLibraryFilter.unsynced => '未同步',
                CaptureLibraryFilter.failed => '同步失败',
                CaptureLibraryFilter.synced => '已同步',
                CaptureLibraryFilter.recording => '录音',
                CaptureLibraryFilter.files => '图片／文件',
              };
              return Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  label: Text(label),
                  selected: filter == value,
                  onSelected: (_) => setState(() => filter = value),
                ),
              );
            }).toList(),
          ),
        ),
        const SizedBox(height: 10),
        if (visible.isEmpty)
          const _EmptyQueue()
        else
          ...visible
              .take(100)
              .map(
                (entry) => _CaptureTile(
                  entry: entry,
                  onRetry: () => widget.controller.retry(entry.id),
                  onEdit: () => showRecord(entry),
                  onPriority: () =>
                      widget.controller.setPriority(entry.id, !entry.priority),
                  onPause: entry.syncState == CaptureSyncState.synced
                      ? null
                      : () => widget.controller.setRecordSyncPaused(
                          entry.id,
                          !entry.syncPaused,
                        ),
                ),
              ),
      ],
    ];
  }

  Future<void> editRecord(CaptureEntry entry) async {
    final title = TextEditingController(text: entry.displayTitle);
    final content = TextEditingController(text: entry.content);
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('修改待同步记录'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  key: const Key('edit-capture-title'),
                  controller: title,
                  maxLength: 60,
                  decoration: const InputDecoration(labelText: '本地标题'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('edit-capture-content'),
                  controller: content,
                  minLines: 4,
                  maxLines: 10,
                  maxLength: 100000,
                  decoration: const InputDecoration(labelText: '原始文字'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              key: const Key('confirm-edit-capture'),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('保存修改'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      await widget.controller.updatePendingRecord(
        id: entry.id,
        title: title.text,
        content: content.text,
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      title.dispose();
      content.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([
        widget.controller,
        widget.recordingController,
      ]),
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          titleSpacing: 20,
          title: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('快速记录', style: TextStyle(fontWeight: FontWeight.w700)),
              Text(
                'LY Creator OS',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400),
              ),
            ],
          ),
          actions: [
            IconButton(
              tooltip: '手机设置',
              onPressed: showSettings,
              icon: const Icon(Icons.tune_rounded),
            ),
            Padding(
              padding: const EdgeInsets.only(right: 14),
              child: InkWell(
                borderRadius: BorderRadius.circular(99),
                onTap: showConnection,
                child: _StatusPill(
                  count: widget.controller.pendingCount,
                  connected: widget.controller.connection != null,
                  syncing: widget.controller.syncing,
                ),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: widget.controller.loading
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
                  children: [
                    TextField(
                      key: const Key('capture-input'),
                      controller: textController,
                      focusNode: focusNode,
                      autofocus: true,
                      minLines: 7,
                      maxLines: 12,
                      maxLength: 100000,
                      onChanged: (value) {
                        widget.controller.updateDraft(value);
                        setState(() {});
                      },
                      decoration: const InputDecoration(
                        hintText: '记下刚想到的角度、真实体验或一个待做选题……',
                        counterText: '',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      children: [
                        FilledButton.tonalIcon(
                          key: const Key('record-audio'),
                          onPressed: saving
                              ? null
                              : widget.recordingController.snapshot.state ==
                                    RecordingState.idle
                              ? () => recordingCommand(
                                  widget.recordingController.start,
                                )
                              : null,
                          icon: const Icon(Icons.mic_rounded, size: 18),
                          label: const Text('录音'),
                        ),
                        OutlinedButton.icon(
                          key: const Key('take-photo'),
                          onPressed: saving ? null : takePhoto,
                          icon: const Icon(
                            Icons.photo_camera_rounded,
                            size: 18,
                          ),
                          label: const Text('拍照'),
                        ),
                        OutlinedButton.icon(
                          key: const Key('pick-media'),
                          onPressed: saving ? null : pickMedia,
                          icon: const Icon(
                            Icons.photo_library_rounded,
                            size: 18,
                          ),
                          label: const Text('相册'),
                        ),
                        OutlinedButton.icon(
                          key: const Key('pick-attachments'),
                          onPressed: saving ? null : pickAttachments,
                          icon: const Icon(Icons.attach_file_rounded, size: 18),
                          label: const Text('文件'),
                        ),
                      ],
                    ),
                    if (widget.recordingController.snapshot.state !=
                        RecordingState.idle) ...[
                      const SizedBox(height: 12),
                      _RecordingPanel(
                        controller: widget.recordingController,
                        onCommand: recordingCommand,
                        onDiscard: confirmDiscardRecording,
                      ),
                    ],
                    const SizedBox(height: 14),
                    FilledButton.icon(
                      key: const Key('save-capture'),
                      onPressed: saving || textController.text.trim().isEmpty
                          ? null
                          : save,
                      icon: saving
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.arrow_upward_rounded),
                      label: Text(saving ? '正在保存…' : '保存'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                    if (widget.controller.connectionError != null) ...[
                      const SizedBox(height: 8),
                      InkWell(
                        onTap: showConnection,
                        borderRadius: BorderRadius.circular(12),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 4,
                            vertical: 6,
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.error_outline_rounded,
                                size: 16,
                                color: Color(0xffa34b3d),
                              ),
                              const SizedBox(width: 7),
                              Expanded(
                                child: Text(
                                  widget.controller.connectionError!,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: Color(0xff8d4438),
                                  ),
                                ),
                              ),
                              const Icon(Icons.chevron_right_rounded, size: 17),
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (widget.controller.intakeError != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        widget.controller.intakeError!,
                        style: const TextStyle(
                          fontSize: 11,
                          color: Color(0xff8d4438),
                        ),
                      ),
                    ],
                    ..._historySection(),
                  ],
                ),
        ),
      ),
    );
  }
}

class _RecordActionsSheet extends StatelessWidget {
  const _RecordActionsSheet({required this.entry});

  final CaptureEntry entry;

  @override
  Widget build(BuildContext context) {
    final editable =
        entry.attemptCount == 0 && entry.syncState == CaptureSyncState.pending;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              entry.displayTitle,
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            if (entry.content.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                entry.content,
                maxLines: 8,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(height: 1.5),
              ),
            ],
            if (entry.notes.trim().isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                '备注',
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(entry.notes, maxLines: 6, overflow: TextOverflow.ellipsis),
            ],
            if (entry.attachments.isNotEmpty) ...[
              const SizedBox(height: 12),
              ...entry.attachments.map(
                (attachment) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.attach_file_rounded),
                  title: Text(
                    attachment.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(_formatBytes(attachment.sizeBytes)),
                  trailing: entry.localCopyRemovedAt == null
                      ? IconButton(
                          tooltip: '单独分享这个附件',
                          onPressed: () =>
                              Navigator.pop(context, 'share:${attachment.id}'),
                          icon: const Icon(Icons.ios_share_rounded),
                        )
                      : null,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (editable)
                  OutlinedButton.icon(
                    onPressed: () => Navigator.pop(context, 'edit'),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('修改原文'),
                  ),
                OutlinedButton.icon(
                  onPressed: () => Navigator.pop(context, 'note'),
                  icon: const Icon(Icons.note_add_outlined),
                  label: const Text('追加备注'),
                ),
                OutlinedButton.icon(
                  onPressed: () => Navigator.pop(context, 'share'),
                  icon: const Icon(Icons.ios_share_rounded),
                  label: Text(
                    entry.localCopyRemovedAt == null ? '再次分享' : '分享文字与备注',
                  ),
                ),
                TextButton.icon(
                  onPressed: () => Navigator.pop(context, 'delete'),
                  icon: const Icon(Icons.delete_outline_rounded),
                  label: Text(
                    entry.syncState == CaptureSyncState.synced &&
                            !entry.hasPendingNoteSync
                        ? '删除手机副本'
                        : '移入回收站',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SetupSheet extends StatefulWidget {
  const _SetupSheet({required this.controller, required this.settings});

  final CaptureQueueController controller;
  final MobileAppSettings settings;

  @override
  State<_SetupSheet> createState() => _SetupSheetState();
}

class _SetupSheetState extends State<_SetupSheet> {
  MobileSetupStatus? status;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(refresh());
  }

  Future<void> refresh() async {
    final next = await widget.controller.setupStatus();
    if (mounted) setState(() => status = next);
  }

  Future<void> requestPermissions() async {
    setState(() => busy = true);
    try {
      final next = await widget.controller.requestCorePermissions();
      if (mounted) setState(() => status = next);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = status;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        18,
        20,
        24 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: ListView(
        shrinkWrap: true,
        children: [
          Text(
            '一次完成手机设置',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          const SizedBox(height: 16),
          _SetupRow(
            label: '麦克风',
            ready: current?.microphone == true,
            detail: 'App内、锁屏和快捷磁贴录音',
          ),
          _SetupRow(
            label: '相机',
            ready: current?.camera == true,
            detail: 'App内拍照记录',
          ),
          _SetupRow(
            label: '通知',
            ready: current?.notifications == true,
            detail: '后台录音控制和异常提醒',
          ),
          _SetupRow(
            label: 'App更新',
            ready: current?.installUpdates == true,
            detail: '允许安装主Mac提供的同签名私人APK',
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: busy ? null : requestPermissions,
            icon: const Icon(Icons.verified_user_outlined),
            label: Text(busy ? '正在请求…' : '授予麦克风、相机和通知权限'),
          ),
          OutlinedButton.icon(
            onPressed: () async {
              await widget.controller.openInstallSettings();
              await refresh();
            },
            icon: const Icon(Icons.system_update_alt_rounded),
            label: const Text('允许从本App安装私人更新'),
          ),
          const SizedBox(height: 8),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () async {
              await widget.settings.completeSetup();
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text('完成初始化'),
          ),
        ],
      ),
    );
  }
}

class _SetupRow extends StatelessWidget {
  const _SetupRow({
    required this.label,
    required this.ready,
    required this.detail,
  });

  final String label;
  final bool ready;
  final String detail;

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    leading: Icon(
      ready ? Icons.check_circle_rounded : Icons.pending_outlined,
      color: ready ? const Color(0xff657653) : const Color(0xffa67c45),
    ),
    title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
    subtitle: Text(detail),
  );
}

class _SettingsSheet extends StatefulWidget {
  const _SettingsSheet({
    required this.controller,
    required this.settings,
    required this.onSetup,
    required this.onEnableLock,
    required this.ensureHistoryAccess,
  });

  final CaptureQueueController controller;
  final MobileAppSettings settings;
  final Future<void> Function() onSetup;
  final Future<bool> Function() onEnableLock;
  final Future<bool> Function() ensureHistoryAccess;

  @override
  State<_SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends State<_SettingsSheet> {
  int? storageBytes;
  bool checkingUpdate = false;

  @override
  void initState() {
    super.initState();
    unawaited(
      widget.controller.appStorageBytes().then((value) {
        if (mounted) setState(() => storageBytes = value);
      }),
    );
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
    child: ListView(
      children: [
        Text(
          '手机设置',
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 10),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('隐私锁'),
          value: widget.settings.historyLockEnabled,
          onChanged: (enabled) async {
            if (enabled && !await widget.onEnableLock()) return;
            if (!enabled && !await widget.ensureHistoryAccess()) return;
            await widget.settings.setHistoryLock(enabled);
            if (mounted) setState(() {});
          },
        ),
        if (widget.settings.historyLockEnabled)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('离开多久后重新锁定'),
            trailing: DropdownButton<int>(
              value: widget.settings.historyLockMinutes,
              items: const [1, 5, 15, 30, 60]
                  .map(
                    (minutes) => DropdownMenuItem(
                      value: minutes,
                      child: Text('$minutes分钟'),
                    ),
                  )
                  .toList(),
              onChanged: (value) async {
                if (value == null) return;
                await widget.settings.setHistoryLockMinutes(value);
                if (mounted) setState(() {});
              },
            ),
          ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.security_rounded),
          title: const Text('权限设置'),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () async {
            Navigator.pop(context);
            await widget.onSetup();
          },
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.storage_rounded),
          title: const Text('空间管理'),
          subtitle: Text(
            storageBytes == null
                ? '正在计算App占用…'
                : '当前占用约${_formatBytes(storageBytes!)}',
          ),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () async {
            if (!await widget.ensureHistoryAccess()) return;
            if (!context.mounted) return;
            await showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              useSafeArea: true,
              builder: (context) => _SpaceSheet(controller: widget.controller),
            );
            final value = await widget.controller.appStorageBytes();
            if (mounted) setState(() => storageBytes = value);
          },
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.delete_outline_rounded),
          title: const Text('手机回收站'),
          subtitle: Text(
            '${widget.controller.trashedEntries.length}条·未同步记录保留30天',
          ),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () async {
            if (!await widget.ensureHistoryAccess()) return;
            if (!context.mounted) return;
            await showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              useSafeArea: true,
              builder: (context) => _TrashSheet(controller: widget.controller),
            );
          },
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('暂停全部同步'),
          subtitle: const Text('记录仍继续安全保存到手机'),
          value: widget.controller.syncPaused,
          onChanged: widget.controller.setGlobalSyncPaused,
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.bug_report_outlined),
          title: const Text('导出脱敏诊断包'),
          subtitle: const Text('只含版本、数量和状态，不含正文、文件名、路径、密钥或遥测'),
          onTap: widget.controller.exportDiagnostics,
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.system_update_alt_rounded),
          title: const Text('从主Mac检查App更新'),
          subtitle: const Text('只下载同一局域网内、与当前App签名一致的私人APK'),
          trailing: checkingUpdate
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.chevron_right_rounded),
          onTap: checkingUpdate
              ? null
              : () async {
                  setState(() => checkingUpdate = true);
                  String message;
                  try {
                    message = await widget.controller.checkAndInstallUpdate();
                  } catch (error) {
                    message = error.toString();
                  }
                  if (!context.mounted) return;
                  setState(() => checkingUpdate = false);
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(SnackBar(content: Text(message)));
                },
        ),
        const SizedBox(height: 8),
        const Text(
          'LY快速记录不使用云账号、不上传遥测、不备份到Google。',
          style: TextStyle(fontSize: 12),
        ),
      ],
    ),
  );
}

class _TrashSheet extends StatelessWidget {
  const _TrashSheet({required this.controller});

  final CaptureQueueController controller;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
      child: Column(
        children: [
          Text(
            '手机回收站',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          const Text('只保存未同步记录30天；永久删除不会通知Mac。'),
          const SizedBox(height: 12),
          Expanded(
            child: controller.trashedEntries.isEmpty
                ? const Center(child: Text('回收站为空'))
                : ListView(
                    children: controller.trashedEntries.map((entry) {
                      final expires = entry.deletedAt!
                          .add(const Duration(days: 30))
                          .toLocal();
                      return ListTile(
                        title: Text(entry.displayTitle),
                        subtitle: Text(
                          '${expires.month}月${expires.day}日自动永久删除',
                        ),
                        trailing: Wrap(
                          children: [
                            IconButton(
                              tooltip: '恢复',
                              onPressed: () =>
                                  controller.restoreFromTrash(entry.id),
                              icon: const Icon(Icons.restore_rounded),
                            ),
                            IconButton(
                              tooltip: '永久删除',
                              onPressed: () async {
                                final confirmed = await showDialog<bool>(
                                  context: context,
                                  builder: (context) => AlertDialog(
                                    title: const Text('永久删除这条记录？'),
                                    content: const Text('手机原件和附件会立即删除，无法恢复。'),
                                    actions: [
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.pop(context, false),
                                        child: const Text('取消'),
                                      ),
                                      FilledButton(
                                        onPressed: () =>
                                            Navigator.pop(context, true),
                                        child: const Text('永久删除'),
                                      ),
                                    ],
                                  ),
                                );
                                if (confirmed == true) {
                                  await controller.permanentlyDelete(entry.id);
                                }
                              },
                              icon: const Icon(Icons.delete_forever_outlined),
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                  ),
          ),
        ],
      ),
    ),
  );
}

enum _SpaceSort { largest, oldest }

class _SpaceSheet extends StatefulWidget {
  const _SpaceSheet({required this.controller});

  final CaptureQueueController controller;

  @override
  State<_SpaceSheet> createState() => _SpaceSheetState();
}

class _SpaceSheetState extends State<_SpaceSheet> {
  _SpaceSort sort = _SpaceSort.largest;
  final selected = <String>{};
  bool clearing = false;

  List<CaptureEntry> get candidates {
    final items = widget.controller.entries
        .where(
          (entry) =>
              entry.syncState == CaptureSyncState.synced &&
              entry.hasLocalAttachmentCopies,
        )
        .toList();
    int bytes(CaptureEntry entry) => entry.attachments.fold(
      0,
      (total, attachment) => total + attachment.sizeBytes,
    );
    if (sort == _SpaceSort.largest) {
      items.sort((left, right) => bytes(right).compareTo(bytes(left)));
    } else {
      items.sort((left, right) => left.createdAt.compareTo(right.createdAt));
    }
    return items;
  }

  @override
  Widget build(BuildContext context) {
    final items = candidates;
    final reclaimable = items.fold<int>(
      0,
      (total, entry) =>
          total +
          entry.attachments.fold<int>(
            0,
            (sum, attachment) => sum + attachment.sizeBytes,
          ),
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
      child: Column(
        children: [
          Text(
            '空间管理',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text('只可清理已同步手机附件副本·可释放约${_formatBytes(reclaimable)}'),
          const SizedBox(height: 10),
          SegmentedButton<_SpaceSort>(
            segments: const [
              ButtonSegment(value: _SpaceSort.largest, label: Text('大文件')),
              ButtonSegment(value: _SpaceSort.oldest, label: Text('最早记录')),
            ],
            selected: {sort},
            onSelectionChanged: (value) => setState(() => sort = value.single),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: items.isEmpty
                ? const Center(child: Text('没有可安全清理的已同步附件'))
                : ListView(
                    children: items.map((entry) {
                      final bytes = entry.attachments.fold<int>(
                        0,
                        (total, attachment) => total + attachment.sizeBytes,
                      );
                      return CheckboxListTile(
                        value: selected.contains(entry.id),
                        onChanged: (value) => setState(() {
                          if (value == true) {
                            selected.add(entry.id);
                          } else {
                            selected.remove(entry.id);
                          }
                        }),
                        title: Text(entry.displayTitle),
                        subtitle: Text(
                          '${entry.attachments.length}个附件·${_formatBytes(bytes)}',
                        ),
                      );
                    }).toList(),
                  ),
          ),
          FilledButton.icon(
            onPressed: selected.isEmpty || clearing
                ? null
                : () async {
                    setState(() => clearing = true);
                    await widget.controller.clearSyncedLocalCopies(selected);
                    if (!mounted) return;
                    setState(() {
                      selected.clear();
                      clearing = false;
                    });
                  },
            icon: const Icon(Icons.cleaning_services_outlined),
            label: Text(clearing ? '正在清理…' : '清理所选手机副本'),
          ),
        ],
      ),
    );
  }
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.count,
    required this.connected,
    required this.syncing,
  });
  final int count;
  final bool connected;
  final bool syncing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xffebe5d9),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        !connected
            ? '连接Mac'
            : syncing
            ? '同步中…'
            : count == 0
            ? '全部已同步'
            : '待同步$count条',
        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _RecordingPanel extends StatelessWidget {
  const _RecordingPanel({
    required this.controller,
    required this.onCommand,
    required this.onDiscard,
  });

  final RecordingController controller;
  final Future<void> Function(Future<void> Function() command) onCommand;
  final Future<void> Function() onDiscard;

  @override
  Widget build(BuildContext context) {
    final snapshot = controller.snapshot;
    final duration = Duration(milliseconds: snapshot.durationMs);
    final time =
        '${duration.inMinutes.toString().padLeft(2, '0')}:${(duration.inSeconds % 60).toString().padLeft(2, '0')}';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xfffff4e9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xffd9bca2)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.graphic_eq_rounded, color: Color(0xff9a4d32)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  snapshot.state == RecordingState.paused
                      ? '录音已暂停·$time'
                      : snapshot.state == RecordingState.finalizing
                      ? '正在安全保存录音…'
                      : '正在录音·$time',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text('重点${snapshot.markersMs.length}个'),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: snapshot.state == RecordingState.finalizing
                    ? null
                    : () => onCommand(
                        snapshot.state == RecordingState.paused
                            ? controller.resume
                            : controller.pause,
                      ),
                icon: Icon(
                  snapshot.state == RecordingState.paused
                      ? Icons.play_arrow_rounded
                      : Icons.pause_rounded,
                ),
                label: Text(
                  snapshot.state == RecordingState.paused ? '继续' : '暂停',
                ),
              ),
              OutlinedButton.icon(
                onPressed: snapshot.state == RecordingState.finalizing
                    ? null
                    : () => onCommand(controller.mark),
                icon: const Icon(Icons.bookmark_add_outlined),
                label: const Text('标记重点'),
              ),
              FilledButton.icon(
                onPressed: snapshot.state == RecordingState.finalizing
                    ? null
                    : () => onCommand(controller.stop),
                icon: const Icon(Icons.stop_rounded),
                label: const Text('结束并保存'),
              ),
              TextButton(
                onPressed: snapshot.state == RecordingState.finalizing
                    ? null
                    : onDiscard,
                child: const Text('放弃'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EmptyQueue extends StatelessWidget {
  const _EmptyQueue();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: const Color(0xfffffdf9),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xffddd5c7)),
      ),
      child: const Column(
        children: [
          Icon(Icons.edit_note_rounded, size: 30),
          SizedBox(height: 8),
          Text('还没有记录', style: TextStyle(fontWeight: FontWeight.w600)),
          SizedBox(height: 4),
          Text(
            '保存后会先留在手机，不会因为断网丢失。',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _CaptureTile extends StatelessWidget {
  const _CaptureTile({
    required this.entry,
    required this.onRetry,
    required this.onPriority,
    this.onEdit,
    this.onPause,
  });
  final CaptureEntry entry;
  final VoidCallback onRetry;
  final VoidCallback onPriority;
  final VoidCallback? onEdit;
  final VoidCallback? onPause;

  @override
  Widget build(BuildContext context) {
    final previewAttachment = entry.attachments
        .where(
          (item) =>
              (item.kind == MobileAttachmentKind.image ||
                  item.kind == MobileAttachmentKind.video) &&
              item.previewAttachmentId != null &&
              item.previewLocalPath != null,
        )
        .firstOrNull;
    final baseStateLabel = switch (entry.syncState) {
      CaptureSyncState.pending => '待同步',
      CaptureSyncState.syncing => '同步中',
      CaptureSyncState.paused => '同步已暂停',
      CaptureSyncState.waitingMac => '等待主Mac',
      CaptureSyncState.synced => '已同步',
      CaptureSyncState.failed => '同步失败',
    };
    final stateLabel = entry.noteSyncError != null
        ? '备注同步失败'
        : entry.hasPendingNoteSync
        ? '备注待同步'
        : baseStateLabel;
    final localTime = entry.createdAt.toLocal();
    final timeLabel =
        '${localTime.month}月${localTime.day}日 ${localTime.hour.toString().padLeft(2, '0')}:${localTime.minute.toString().padLeft(2, '0')}';
    return InkWell(
      onTap: onEdit,
      borderRadius: BorderRadius.circular(15),
      child: Container(
        margin: const EdgeInsets.only(bottom: 9),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(15),
          border: Border.all(
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              entry.displayTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            if (entry.content.isNotEmpty &&
                entry.content.trim() != entry.displayTitle) ...[
              const SizedBox(height: 5),
              Text(
                entry.content,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  height: 1.45,
                  fontSize: 12,
                  color: Color(0xff59554e),
                ),
              ),
            ],
            if (entry.attachments.isNotEmpty) ...[
              const SizedBox(height: 9),
              if (previewAttachment != null) ...[
                _EncryptedAttachmentPreview(attachment: previewAttachment),
                const SizedBox(height: 8),
              ],
              Row(
                children: [
                  const Icon(Icons.attach_file_rounded, size: 15),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      '${entry.attachments.length}个附件·${entry.attachments.take(2).map((item) => item.name).join('、')}${entry.attachments.length > 2 ? '等' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xff766f63),
                      ),
                    ),
                  ),
                ],
              ),
              if (entry.syncState == CaptureSyncState.syncing &&
                  entry.attachmentUploadProgress != null) ...[
                const SizedBox(height: 7),
                LinearProgressIndicator(
                  value: entry.attachmentUploadProgress,
                  minHeight: 3,
                  borderRadius: BorderRadius.circular(99),
                ),
              ],
            ],
            if (entry.sourceApp != null || entry.sourceUrl != null) ...[
              const SizedBox(height: 7),
              Row(
                children: [
                  const Icon(Icons.ios_share_rounded, size: 14),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      [
                        if (entry.sourceApp?.trim().isNotEmpty == true)
                          entry.sourceApp!.trim(),
                        if (entry.sourceUrl?.trim().isNotEmpty == true)
                          Uri.tryParse(entry.sourceUrl!)?.host ??
                              entry.sourceUrl!,
                      ].join('·'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xff766f63),
                      ),
                    ),
                  ),
                ],
              ),
            ],
            if (entry.recordingMarkersMs.isNotEmpty ||
                entry.recordingInterruptionReason != null) ...[
              const SizedBox(height: 7),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    entry.recordingInterruptionReason == null
                        ? Icons.bookmark_added_outlined
                        : Icons.warning_amber_rounded,
                    size: 14,
                    color: entry.recordingInterruptionReason == null
                        ? const Color(0xff657653)
                        : const Color(0xffa34b3d),
                  ),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      [
                        if (entry.recordingMarkersMs.isNotEmpty)
                          '重点${entry.recordingMarkersMs.length}处',
                        if (entry.recordingInterruptionReason != null)
                          entry.recordingInterruptionReason!,
                      ].join('·'),
                      style: TextStyle(
                        fontSize: 11,
                        color: entry.recordingInterruptionReason == null
                            ? const Color(0xff766f63)
                            : const Color(0xffa34b3d),
                      ),
                    ),
                  ),
                ],
              ),
            ],
            if (entry.notes.trim().isNotEmpty) ...[
              const SizedBox(height: 7),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.notes_rounded, size: 14),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      entry.notes,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11),
                    ),
                  ),
                ],
              ),
            ],
            if (entry.localCopyRemovedAt != null) ...[
              const SizedBox(height: 7),
              const Text(
                '手机附件副本已清理·Mac内容不受影响',
                style: TextStyle(fontSize: 11, color: Color(0xff8a7250)),
              ),
            ],
            const SizedBox(height: 9),
            Row(
              children: [
                Text(
                  timeLabel,
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xff766f63),
                  ),
                ),
                const Spacer(),
                if (entry.syncState == CaptureSyncState.failed ||
                    entry.noteSyncError != null)
                  TextButton(
                    onPressed: onRetry,
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      minimumSize: const Size(0, 28),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(
                      '$stateLabel·重试',
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xffa34b3d),
                      ),
                    ),
                  )
                else
                  Text(
                    stateLabel,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: Color(0xff657653),
                    ),
                  ),
                IconButton(
                  tooltip: entry.priority ? '取消优先同步' : '优先同步',
                  onPressed: onPriority,
                  icon: Icon(
                    entry.priority
                        ? Icons.vertical_align_top_rounded
                        : Icons.low_priority_rounded,
                    size: 18,
                  ),
                ),
                if (onPause != null)
                  IconButton(
                    tooltip: entry.syncPaused ? '恢复这条同步' : '暂停这条同步',
                    onPressed: onPause,
                    icon: Icon(
                      entry.syncPaused
                          ? Icons.play_arrow_rounded
                          : Icons.pause_rounded,
                      size: 18,
                    ),
                  ),
              ],
            ),
            if (entry.lastError != null || entry.noteSyncError != null)
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Text(
                  entry.noteSyncError ?? entry.lastError!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10,
                    color: Color(0xffa34b3d),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EncryptedAttachmentPreview extends StatefulWidget {
  const _EncryptedAttachmentPreview({required this.attachment});

  final MobileAttachment attachment;

  @override
  State<_EncryptedAttachmentPreview> createState() =>
      _EncryptedAttachmentPreviewState();
}

class _EncryptedAttachmentPreviewState
    extends State<_EncryptedAttachmentPreview> {
  static const _channel = MethodChannel(
    'ly.creator.capture/attachment_storage',
  );
  late Future<Uint8List?> bytes = load();

  Future<Uint8List?> load() async {
    final path = widget.attachment.previewLocalPath;
    final id = widget.attachment.previewAttachmentId;
    if (path == null || id == null) return null;
    return _channel.invokeMethod<Uint8List>('readPreview', {
      'path': path,
      'attachmentId': id,
    });
  }

  @override
  void didUpdateWidget(covariant _EncryptedAttachmentPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.previewLocalPath !=
            widget.attachment.previewLocalPath ||
        oldWidget.attachment.previewAttachmentId !=
            widget.attachment.previewAttachmentId) {
      bytes = load();
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List?>(
    future: bytes,
    builder: (context, snapshot) {
      final data = snapshot.data;
      if (data == null || data.isEmpty) return const SizedBox.shrink();
      return ClipRRect(
        borderRadius: BorderRadius.circular(11),
        child: Stack(
          alignment: Alignment.center,
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: Image.memory(
                data,
                fit: BoxFit.cover,
                gaplessPlayback: true,
                semanticLabel:
                    widget.attachment.kind == MobileAttachmentKind.video
                    ? '视频预览'
                    : '图片预览',
              ),
            ),
            if (widget.attachment.kind == MobileAttachmentKind.video)
              Container(
                padding: const EdgeInsets.all(8),
                decoration: const BoxDecoration(
                  color: Color(0x99000000),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 24,
                ),
              ),
          ],
        ),
      );
    },
  );
}

class _ConnectionSheet extends StatefulWidget {
  const _ConnectionSheet({required this.controller});
  final CaptureQueueController controller;

  @override
  State<_ConnectionSheet> createState() => _ConnectionSheetState();
}

class _ConnectionSheetState extends State<_ConnectionSheet> {
  final nameController = TextEditingController(text: '我的Android手机');

  @override
  void dispose() {
    nameController.dispose();
    super.dispose();
  }

  Future<void> connect(DesktopService service, {bool upgrade = false}) async {
    try {
      await widget.controller.connect(
        service: service,
        deviceName: nameController.text,
        upgrade: upgrade,
      );
    } catch (_) {
      // Controller保留了可直接展示的错误。
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        final connection = widget.controller.connection;
        final attempt = widget.controller.pairingAttempt;
        final services = widget.controller.discoveredServices;
        return Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            12,
            20,
            20 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Center(
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xffd6cec0),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    const Icon(Icons.laptop_mac_rounded, size: 23),
                    const SizedBox(width: 9),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '连接Mac',
                            style: TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            '同一Wi-Fi自动发现，不用填写地址或同步码',
                            style: TextStyle(fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (attempt != null) ...[
                  _PairingCodeCard(attempt: attempt),
                  const SizedBox(height: 12),
                ],
                if (connection == null) ...[
                  TextField(
                    controller: nameController,
                    maxLength: 80,
                    enabled: !widget.controller.pairing,
                    decoration: const InputDecoration(
                      labelText: '这台手机的名称',
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: 13),
                  _DiscoveryHeader(
                    discovering: widget.controller.discovering,
                    onRefresh: widget.controller.refreshDiscovery,
                  ),
                  const SizedBox(height: 7),
                  if (services.isEmpty)
                    _DiscoveryEmpty(
                      discovering: widget.controller.discovering,
                      message: widget.controller.discoveryError,
                    )
                  else
                    ...services.map(
                      (service) => _DesktopServiceTile(
                        service: service,
                        busy: widget.controller.pairing,
                        actionLabel: '连接',
                        onPressed: () => connect(service),
                      ),
                    ),
                ] else if (connection.needsSecurityUpgrade) ...[
                  _ConnectionCard(connection: connection, legacy: true),
                  const SizedBox(height: 12),
                  const Text(
                    '旧版连接需要升级一次，之后换Wi-Fi也会自动连接。记录仍保留在手机，不会丢失。',
                    style: TextStyle(fontSize: 11, height: 1.45),
                  ),
                  const SizedBox(height: 12),
                  _DiscoveryHeader(
                    discovering: widget.controller.discovering,
                    onRefresh: widget.controller.refreshDiscovery,
                  ),
                  const SizedBox(height: 7),
                  if (services.isEmpty)
                    _DiscoveryEmpty(
                      discovering: widget.controller.discovering,
                      message: widget.controller.discoveryError,
                    )
                  else
                    ...services.map(
                      (service) => _DesktopServiceTile(
                        service: service,
                        busy: widget.controller.pairing,
                        actionLabel: '安全升级',
                        onPressed: () => connect(service, upgrade: true),
                      ),
                    ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: widget.controller.pairing
                        ? null
                        : widget.controller.disconnect,
                    child: const Text('移除旧版连接'),
                  ),
                ] else ...[
                  _ConnectionCard(connection: connection),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: widget.controller.syncing
                        ? null
                        : widget.controller.syncPending,
                    icon: const Icon(Icons.sync_rounded),
                    label: Text(
                      widget.controller.syncing
                          ? '正在同步…'
                          : '立即同步${widget.controller.pendingCount}条',
                    ),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: widget.controller.syncing
                        ? null
                        : widget.controller.disconnect,
                    child: const Text('移除这台Mac'),
                  ),
                ],
                if (widget.controller.connectionError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(
                      widget.controller.connectionError!,
                      style: const TextStyle(
                        color: Color(0xffa34b3d),
                        fontSize: 11,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                const Text(
                  '首次核对数字并批准后，手机会长期信任这台Mac。记录先保存在手机，只有Mac完成持久化并返回回执后才显示“已同步”。',
                  style: TextStyle(
                    fontSize: 10,
                    height: 1.5,
                    color: Color(0xff766f63),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DiscoveryHeader extends StatelessWidget {
  const _DiscoveryHeader({required this.discovering, required this.onRefresh});
  final bool discovering;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(
          child: Text(
            '附近的LY Creator OS',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
          ),
        ),
        TextButton.icon(
          onPressed: discovering ? null : onRefresh,
          icon: discovering
              ? const SizedBox.square(
                  dimension: 13,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.refresh_rounded, size: 16),
          label: Text(discovering ? '正在搜索' : '重新搜索'),
        ),
      ],
    );
  }
}

class _DiscoveryEmpty extends StatelessWidget {
  const _DiscoveryEmpty({required this.discovering, required this.message});
  final bool discovering;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xfff4f0e8),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        discovering
            ? '正在搜索同一Wi-Fi内的Mac…'
            : message ?? '暂未发现。请先在Mac设置里开启“Android快速记录”。',
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 11, height: 1.45),
      ),
    );
  }
}

class _DesktopServiceTile extends StatelessWidget {
  const _DesktopServiceTile({
    required this.service,
    required this.busy,
    required this.actionLabel,
    required this.onPressed,
  });
  final DesktopService service;
  final bool busy;
  final String actionLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(13, 10, 9, 10),
      decoration: BoxDecoration(
        color: const Color(0xfffffdf9),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xffddd5c7)),
      ),
      child: Row(
        children: [
          const Icon(Icons.laptop_mac_rounded, size: 20),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  service.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Text(
                  '安全协议v2',
                  style: TextStyle(fontSize: 10, color: Color(0xff657653)),
                ),
              ],
            ),
          ),
          FilledButton(
            onPressed: busy ? null : onPressed,
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 36),
              padding: const EdgeInsets.symmetric(horizontal: 13),
            ),
            child: Text(actionLabel),
          ),
        ],
      ),
    );
  }
}

class _PairingCodeCard extends StatelessWidget {
  const _PairingCodeCard({required this.attempt});
  final PairingAttempt attempt;

  @override
  Widget build(BuildContext context) {
    final code = attempt.shortAuthenticationString;
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: const Color(0xffeef1e8),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xffb9c6aa)),
      ),
      child: Column(
        children: [
          const Text(
            '请在Mac核对相同数字',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            '${code.substring(0, 3)} ${code.substring(3)}',
            style: const TextStyle(
              fontSize: 29,
              fontWeight: FontWeight.w800,
              letterSpacing: 3,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            '数字一致后，在Mac点“数字一致，信任设备”',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({required this.connection, this.legacy = false});
  final DesktopConnection connection;
  final bool legacy;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: legacy ? const Color(0xfffff4e5) : const Color(0xffeef1e8),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: legacy ? const Color(0xffe1bf86) : const Color(0xffcbd3bd),
        ),
      ),
      child: Row(
        children: [
          Icon(
            legacy ? Icons.warning_amber_rounded : Icons.verified_user_rounded,
            color: legacy ? const Color(0xff9a621e) : const Color(0xff657653),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  connection.deviceName,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  legacy ? '旧版连接·等待安全升级' : '安全连接·v2·同网自动同步',
                  style: const TextStyle(fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CaptureRouteObserver extends NavigatorObserver {
  _CaptureRouteObserver(this.onRouteClosed);
  final VoidCallback onRouteClosed;
  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    WidgetsBinding.instance.addPostFrameCallback((_) => onRouteClosed());
  }
}
