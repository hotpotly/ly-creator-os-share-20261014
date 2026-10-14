import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';

import '../intake/share_intake.dart';
import '../maintenance/mobile_maintenance.dart';
import '../model/capture_entry.dart';
import '../model/desktop_connection.dart';
import '../model/desktop_service.dart';
import '../storage/capture_store.dart';
import '../storage/connection_store.dart';
import '../sync/mobile_sync_client.dart';
import '../sync/device_power_status.dart';
import '../sync/sync_policy.dart';

enum CaptureLibraryFilter { all, unsynced, failed, synced, recording, files }

class CaptureQueueController extends ChangeNotifier {
  CaptureQueueController(
    this._store,
    this._connectionStore, {
    MobileSyncClient? syncClient,
    AttachmentIntake? attachmentIntake,
    DevicePowerStatusProvider? powerStatusProvider,
    SyncEnvironmentProvider? syncEnvironmentProvider,
    MobileMaintenance? maintenance,
    bool autoDiscovery = true,
    this._scheduleRetries = true,
    this.backgroundWorker = false,
  }) : _environment =
           syncEnvironmentProvider ?? const NativeSyncEnvironmentProvider(),
       _syncClient = syncClient ?? MobileSyncClient(),
       // ignore: prefer_initializing_formals
       _attachmentIntake = attachmentIntake,
       _powerStatusProvider =
           powerStatusProvider ?? const NativeDevicePowerStatusProvider(),
       _maintenance = maintenance ?? const NativeMobileMaintenance(),
       // ignore: prefer_initializing_formals
       _autoDiscovery = autoDiscovery;

  final bool backgroundWorker;
  bool _autoSyncEnabled = true;
  final SyncEnvironmentProvider _environment;
  bool _foreground = true;
  DateTime? syncDeadline;
  void Function()? onCaptureReceived;

  void setForeground(bool active) {
    _foreground = active;
    if (!active) {
      _retryTimer?.cancel();
      _syncRequested = false;
    }
  }

  Future<bool> canTransfer({bool attachments = false}) async {
    final environment = await _environment.read();
    return !_disposed &&
        _foreground &&
        (syncDeadline == null || DateTime.now().isBefore(syncDeadline!)) &&
        environment.allows(
          attachments: attachments,
          background: backgroundWorker,
        );
  }

  final CaptureStore _store;
  final ConnectionStore _connectionStore;
  final MobileSyncClient _syncClient;
  final AttachmentIntake? _attachmentIntake;
  final DevicePowerStatusProvider _powerStatusProvider;
  final MobileMaintenance _maintenance;
  final bool _autoDiscovery;
  final bool _scheduleRetries;
  final Random _random = Random.secure();
  late final String _leaseOwner = _uuidV4();
  List<CaptureEntry> _entries = [];
  bool _loading = true;
  bool _syncing = false;
  bool _syncRequested = false;
  bool _pairing = false;
  DesktopConnection? _connection;
  PairingAttempt? _pairingAttempt;
  List<DesktopService> _discoveredServices = [];
  bool _discovering = false;
  String? _discoveryError;
  String? _connectionError;
  String? _intakeError;
  bool _importingShares = false;
  bool _syncPaused = false;
  Timer? _retryTimer;
  bool _disposed = false;
  Timer? _draftSaveTimer;
  String _draftContent = '';
  bool _draftLoadFailed = false;
  bool _draftDirty = false;
  final Set<String> _notesInFlight = {};

  bool get loading => _loading;
  bool get syncing => _syncing;
  bool get pairing => _pairing;
  DesktopConnection? get connection => _connection;
  PairingAttempt? get pairingAttempt => _pairingAttempt;
  List<DesktopService> get discoveredServices =>
      List.unmodifiable(_discoveredServices);
  bool get discovering => _discovering;
  String? get discoveryError => _discoveryError;
  String? get connectionError => _connectionError;
  String? get intakeError => _intakeError;
  String get draftContent => _draftContent;
  bool get syncPaused => _syncPaused;
  List<CaptureEntry> get entries =>
      List.unmodifiable(_entries.where((entry) => !entry.isTrashed));
  List<CaptureEntry> get trashedEntries => List.unmodifiable(
    _entries.where((entry) => entry.isTrashed).toList()
      ..sort((left, right) => right.deletedAt!.compareTo(left.deletedAt!)),
  );
  int get pendingCount => _entries
      .where(
        (entry) =>
            !entry.isTrashed &&
            (entry.syncState != CaptureSyncState.synced ||
                entry.hasPendingNoteSync),
      )
      .length;

  Future<void> load({
    bool importShares = true,
    bool syncImmediately = true,
    bool startDiscovery = true,
  }) async {
    _autoSyncEnabled = syncImmediately && !backgroundWorker;
    _entries = await _store.load();
    await _purgeExpiredTrash();
    _syncPaused = await _store.loadSyncPaused();
    try {
      _draftContent = await _store.loadDraft();
    } catch (_) {
      _draftContent = '';
      _draftLoadFailed = true;
      _intakeError = '本地草稿暂时无法恢复，原始加密数据已保留';
    }
    _attachmentIntake?.setOnShareReady(() => unawaited(importPendingShares()));
    try {
      _connection = await _connectionStore.load();
    } catch (_) {
      _connectionError = '无法读取安全连接信息，请重新配对';
    }
    _loading = false;
    notifyListeners();
    if (importShares) await importPendingShares();
    if (syncImmediately && _connection != null) unawaited(syncPending());
    if (startDiscovery &&
        _autoDiscovery &&
        _connection != null &&
        pendingCount > 0) {
      unawaited(refreshDiscovery());
    }
    _autoSyncEnabled = !backgroundWorker;
  }

  Future<CaptureEntry> add(
    String content,
    CaptureHint hint, {
    List<MobileAttachment> attachments = const [],
    String? sourceShareId,
    String? sourceApp,
    String? sourceTitle,
    String? sourceUrl,
    List<int> recordingMarkersMs = const [],
    String? recordingInterruptionReason,
    DateTime? createdAt,
    String? stableId,
  }) async {
    final cleanContent = content.trim();
    if (cleanContent.isEmpty && attachments.isEmpty) {
      throw ArgumentError('请写点内容或添加附件');
    }
    if (cleanContent.length > 100000) throw ArgumentError('记录内容最多100000字');
    final attachmentIds = attachments.map((item) => item.id).toSet();
    if (attachmentIds.length != attachments.length) {
      throw ArgumentError('附件不能重复');
    }
    final normalizedSourceTitle = _boundedText(sourceTitle, 500);
    final normalizedSourceApp = _boundedText(sourceApp, 255);
    final normalizedSourceUrl = _validSourceUrl(sourceUrl);
    final now = DateTime.now().toUtc();
    final recordCreatedAt = createdAt?.toUtc() ?? now;
    final entry = CaptureEntry(
      id: stableId ?? _uuidV4(),
      title: localCaptureTitle(
        content: normalizedSourceTitle?.isNotEmpty == true
            ? normalizedSourceTitle!
            : cleanContent,
        attachments: attachments,
        createdAt: recordCreatedAt,
      ),
      content: cleanContent,
      hint: hint,
      createdAt: recordCreatedAt,
      updatedAt: now,
      syncState: CaptureSyncState.pending,
      attachments: List.unmodifiable(attachments),
      sourceShareId: sourceShareId,
      sourceApp: normalizedSourceApp,
      sourceTitle: normalizedSourceTitle,
      sourceUrl: normalizedSourceUrl,
      recordingMarkersMs: recordingMarkersMs,
      recordingInterruptionReason: recordingInterruptionReason,
    );
    // 只有本地持久化成功才更新界面并清空输入。
    await _store.upsert(entry);
    _entries = [entry, ..._entries];
    if (sourceShareId == null) {
      _draftSaveTimer?.cancel();
      _draftContent = '';
      _draftDirty = false;
      _draftLoadFailed = false;
      await _store.clearDraft();
    }
    notifyListeners();
    if (sourceShareId != null) {
      try {
        await _attachmentIntake?.acknowledge(sourceShareId);
      } catch (error) {
        // 记录已经原子写入本地队列；下次读取系统分享时会按sourceShareId去重并再次确认。
        _intakeError = error.toString();
      }
    }
    if (_connection != null && _autoSyncEnabled) unawaited(syncPending());
    return entry;
  }

  Future<CaptureEntry?> pickAttachments() async {
    try {
      _intakeError = null;
      final picked = await _attachmentIntake?.pickFiles();
      final saved = await _saveSharedCapture(picked);
      notifyListeners();
      return saved;
    } catch (error) {
      _intakeError = error.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<CaptureEntry?> pickMedia() async {
    try {
      _intakeError = null;
      final picked = await _attachmentIntake?.pickMedia();
      final saved = await _saveSharedCapture(picked);
      notifyListeners();
      return saved;
    } catch (error) {
      _intakeError = error.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<CaptureEntry?> takePhoto() async {
    try {
      _intakeError = null;
      final photo = await _attachmentIntake?.takePhoto();
      final saved = await _saveSharedCapture(photo);
      notifyListeners();
      return saved;
    } catch (error) {
      _intakeError = error.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> importPendingShares() async {
    final intake = _attachmentIntake;
    if (intake == null || _importingShares) return;
    _importingShares = true;
    var lease = false;
    try {
      lease = await _store.tryAcquireLease(
        'share-import',
        _leaseOwner,
        DateTime.now().toUtc().add(const Duration(minutes: 2)),
      );
      if (!lease) return;
      final pending = await intake.listPendingShares();
      if (pending.isNotEmpty) onCaptureReceived?.call();
      for (final shared in pending) {
        try {
          final existing = _entries.any(
            (entry) => entry.sourceShareId == shared.shareId,
          );
          if (existing) {
            await intake.acknowledge(shared.shareId);
            continue;
          }
          if (shared.error != null ||
              (shared.content.trim().isEmpty && shared.attachments.isEmpty)) {
            _intakeError = shared.error ?? '系统分享没有可保存的内容';
            await intake.acknowledge(shared.shareId);
            continue;
          }
          await _saveSharedCapture(shared);
        } catch (error) {
          // A malformed or temporarily unreadable share must not block later
          // durable jobs. It stays in the native queue for a future retry.
          _intakeError = error.toString();
        }
      }
    } catch (error) {
      _intakeError = error.toString();
    } finally {
      if (lease) await _store.releaseLease('share-import', _leaseOwner);
      _importingShares = false;
      notifyListeners();
    }
  }

  Future<CaptureEntry?> _saveSharedCapture(SharedCaptureInput? shared) async {
    if (shared == null) return null;
    final existing = _entries
        .where((entry) => entry.sourceShareId == shared.shareId)
        .firstOrNull;
    if (existing != null) {
      await _attachmentIntake?.acknowledge(shared.shareId);
      return existing;
    }
    if (shared.error != null ||
        (shared.content.trim().isEmpty && shared.attachments.isEmpty)) {
      throw StateError(shared.error ?? '没有可保存的内容');
    }
    return add(
      shared.content,
      CaptureHint.auto,
      attachments: shared.attachments,
      sourceShareId: shared.shareId,
      sourceApp: shared.sourceApp,
      sourceTitle: shared.sourceTitle,
      sourceUrl: shared.sourceUrl,
      recordingMarkersMs: shared.recordingMarkersMs,
      recordingInterruptionReason: shared.recordingInterruptionReason,
      createdAt: shared.createdAt,
      stableId: await _captureIdForShare(shared.shareId),
    );
  }

  void updateDraft(String content) {
    _draftContent = content;
    _draftDirty = true;
    _draftLoadFailed = false;
    _draftSaveTimer?.cancel();
    _draftSaveTimer = Timer(
      const Duration(milliseconds: 250),
      () => unawaited(flushDraft()),
    );
  }

  Future<void> flushDraft() async {
    _draftSaveTimer?.cancel();
    _draftSaveTimer = null;
    if (_draftLoadFailed || !_draftDirty) return;
    try {
      await _store.saveDraft(_draftContent);
      _draftDirty = false;
    } catch (_) {
      _intakeError = '本地草稿保存失败，请保留当前页面并检查手机空间';
      notifyListeners();
    }
  }

  Future<void> connect({
    required DesktopService service,
    required String deviceName,
    bool upgrade = false,
  }) async {
    if (_pairing) return;
    final previousConnection = _connection;
    if (upgrade &&
        (previousConnection == null ||
            !previousConnection.needsSecurityUpgrade)) {
      throw const MobileSyncException('当前设备不需要安全升级');
    }
    _pairing = true;
    var networkHeld = false;
    _pairingAttempt = null;
    _connectionError = null;
    notifyListeners();
    try {
      if (!await canTransfer()) throw const MobileSyncException('请连接Wi-Fi后重试');
      networkHeld = await _environment.acquireWifi();
      if (!networkHeld) throw const MobileSyncException('Wi-Fi暂时不可用');
      final attempt = await _syncClient.beginPairing(
        service: service,
        deviceName: deviceName,
        upgradeConnection: upgrade ? previousConnection : null,
      );
      _pairingAttempt = attempt;
      notifyListeners();
      final connection = await _syncClient.waitForApproval(attempt);
      await _connectionStore.save(connection);
      _connection = connection;
    } catch (error) {
      _connectionError = error.toString();
      rethrow;
    } finally {
      if (networkHeld) await _environment.releaseWifi();
      _pairing = false;
      _pairingAttempt = null;
      notifyListeners();
    }
    await syncPending();
  }

  Future<void> disconnect() async {
    _retryTimer?.cancel();
    await _connectionStore.clear();
    _connection = null;
    _connectionError = null;
    notifyListeners();
  }

  Future<void> refreshDiscovery({bool syncAfterRefresh = true}) async {
    if (_discovering) return;
    _discovering = true;
    var networkHeld = false;
    _discoveryError = null;
    notifyListeners();
    try {
      if (!await canTransfer()) return;
      networkHeld = await _environment.acquireWifi();
      if (!networkHeld) return;
      final services = await _syncClient.discoverServices();
      _discoveredServices = services;
      final connection = _connection;
      if (connection != null &&
          connection.protocolVersion == mobileSyncProtocolV2 &&
          connection.serviceId != null) {
        final match = services
            .where((service) => service.serviceId == connection.serviceId)
            .firstOrNull;
        if (match != null) {
          if (match.address != connection.address) {
            final refreshed = connection.copyWithAddress(match.address);
            await _connectionStore.save(refreshed);
            _connection = refreshed;
          }
          if (syncAfterRefresh) unawaited(syncPending());
        }
      }
    } catch (error) {
      _discoveryError = error.toString();
    } finally {
      if (networkHeld) await _environment.releaseWifi();
      _discovering = false;
      notifyListeners();
    }
  }

  Future<void> retry(String id) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null ||
        entry.isTrashed ||
        (entry.syncState == CaptureSyncState.synced &&
            !entry.hasPendingNoteSync)) {
      return;
    }
    if (entry.syncState == CaptureSyncState.synced) {
      await replace(entry.copyWith(noteSyncError: null));
      await syncPending();
      return;
    }
    await replace(
      entry.copyWith(syncState: CaptureSyncState.pending, clearLastError: true),
    );
    await syncPending();
  }

  Future<void> setGlobalSyncPaused(bool paused) async {
    _syncPaused = paused;
    _retryTimer?.cancel();
    await _store.saveSyncPaused(paused);
    notifyListeners();
    if (!paused) unawaited(syncPending());
  }

  Future<void> setRecordSyncPaused(String id, bool paused) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null || entry.syncState == CaptureSyncState.synced) return;
    await replace(
      entry.copyWith(
        syncPaused: paused,
        syncState: paused ? CaptureSyncState.paused : CaptureSyncState.pending,
      ),
    );
    if (!paused) unawaited(syncPending());
  }

  Future<void> setPriority(String id, bool priority) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null) return;
    await replace(entry.copyWith(priority: priority));
    if (priority) unawaited(syncPending());
  }

  Future<void> updatePendingRecord({
    required String id,
    required String title,
    required String content,
  }) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null) throw ArgumentError('记录不存在');
    if (entry.attemptCount > 0 ||
        entry.syncState == CaptureSyncState.syncing ||
        entry.syncState == CaptureSyncState.synced) {
      throw StateError('记录已经开始同步，不能覆盖原文');
    }
    final cleanContent = content.trim();
    if (cleanContent.isEmpty && entry.attachments.isEmpty) {
      throw ArgumentError('请保留文字或附件');
    }
    await replace(
      entry.copyWith(
        title: title.trim().isEmpty
            ? localCaptureTitle(
                content: cleanContent,
                attachments: entry.attachments,
                createdAt: entry.createdAt,
              )
            : boundedCaptureTitle(title),
        content: cleanContent,
        syncState: CaptureSyncState.pending,
        clearLastError: true,
      ),
    );
    if (_connection != null && _autoSyncEnabled) unawaited(syncPending());
  }

  List<CaptureEntry> search({
    String query = '',
    CaptureLibraryFilter filter = CaptureLibraryFilter.all,
  }) {
    final normalized = query.trim().toLowerCase();
    return entries.where((entry) {
      final matchesFilter = switch (filter) {
        CaptureLibraryFilter.all => true,
        CaptureLibraryFilter.unsynced =>
          entry.syncState != CaptureSyncState.synced ||
              entry.hasPendingNoteSync,
        CaptureLibraryFilter.failed =>
          entry.syncState == CaptureSyncState.failed ||
              entry.noteSyncError != null,
        CaptureLibraryFilter.synced =>
          entry.syncState == CaptureSyncState.synced &&
              !entry.hasPendingNoteSync,
        CaptureLibraryFilter.recording => entry.attachments.any(
          (attachment) => attachment.kind == MobileAttachmentKind.audio,
        ),
        CaptureLibraryFilter.files => entry.attachments.any(
          (attachment) => attachment.kind != MobileAttachmentKind.audio,
        ),
      };
      if (!matchesFilter || normalized.isEmpty) return matchesFilter;
      final searchable = [
        entry.title,
        entry.displayTitle,
        entry.content,
        entry.sourceUrl ?? '',
        Uri.tryParse(entry.sourceUrl ?? '')?.host ?? '',
        entry.sourceApp ?? '',
        entry.sourceTitle ?? '',
        entry.notes,
        ...entry.attachments.map((attachment) => attachment.name),
      ].join('\n').toLowerCase();
      return searchable.contains(normalized);
    }).toList();
  }

  Future<void> appendNote(String id, String note) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null || entry.isTrashed) throw ArgumentError('记录不存在');
    final clean = note.replaceAll('\r\n', '\n').trim();
    if (clean.isEmpty) throw ArgumentError('请写下要追加的备注');
    if (clean.length > 10000) throw ArgumentError('单次追加备注最多10000字');
    final combined = entry.notes.trim().isEmpty
        ? clean
        : '${entry.notes.trimRight()}\n$clean';
    if (combined.length > 100000) {
      throw ArgumentError('这条记录的备注总长度最多100000字');
    }
    if (entry.syncState == CaptureSyncState.syncing) {
      throw StateError('记录正在同步，请完成后再追加');
    }
    final needsIndependentNoteUpdate =
        entry.syncState == CaptureSyncState.synced || entry.attemptCount > 0;
    final revision = !needsIndependentNoteUpdate
        ? entry.notesRevision
        : _notesInFlight.contains(entry.id) || entry.noteSyncError != null
        ? entry.notesRevision + 1
        : entry.hasPendingNoteSync ||
              entry.notesRevision > entry.notesSyncedRevision
        ? entry.notesRevision
        : entry.notesRevision + 1;
    await replace(
      entry.copyWith(
        notes: combined,
        notesRevision: revision,
        noteSyncError: null,
      ),
    );
    if (_connection != null && _autoSyncEnabled) unawaited(syncPending());
  }

  Future<void> deleteRecord(String id) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null) return;
    if (entry.syncState == CaptureSyncState.synced &&
        !entry.hasPendingNoteSync) {
      await _deletePermanently(entry);
      return;
    }
    await replace(
      entry.copyWith(
        deletedAt: DateTime.now().toUtc(),
        syncPaused: true,
        syncState: entry.desktopCaptureId == null
            ? CaptureSyncState.paused
            : CaptureSyncState.synced,
      ),
    );
  }

  Future<void> restoreFromTrash(String id) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null || !entry.isTrashed) return;
    await replace(
      entry.copyWith(
        deletedAt: null,
        syncPaused: false,
        syncState: entry.desktopCaptureId == null
            ? CaptureSyncState.pending
            : CaptureSyncState.synced,
        clearLastError: true,
      ),
    );
    if (_connection != null && _autoSyncEnabled) unawaited(syncPending());
  }

  Future<void> permanentlyDelete(String id) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null) return;
    await _deletePermanently(entry);
  }

  Future<void> clearSyncedLocalCopies(Iterable<String> ids) async {
    for (final id in ids.toSet()) {
      final entry = _entries.where((item) => item.id == id).firstOrNull;
      if (entry == null ||
          entry.syncState != CaptureSyncState.synced ||
          !entry.hasLocalAttachmentCopies) {
        continue;
      }
      await _maintenance.deletePrivateCopies(entry.attachments);
      await replace(entry.copyWith(localCopyRemovedAt: DateTime.now().toUtc()));
    }
  }

  Future<void> shareRecord(String id, {String? attachmentId}) async {
    final entry = _entries.where((item) => item.id == id).firstOrNull;
    if (entry == null || entry.isTrashed) throw ArgumentError('记录不存在');
    if (entry.localCopyRemovedAt != null && attachmentId != null) {
      throw StateError('这条记录的手机附件副本已经清理');
    }
    await _maintenance.share(
      entry.localCopyRemovedAt == null
          ? entry
          : entry.copyWith(attachments: const []),
      attachmentId: attachmentId,
    );
  }

  Future<int> appStorageBytes() => _maintenance.appStorageBytes();

  Future<MobileSetupStatus> setupStatus() => _maintenance.setupStatus();

  Future<MobileSetupStatus> requestCorePermissions() =>
      _maintenance.requestCorePermissions();

  Future<void> openBatterySettings() => _maintenance.openBatterySettings();

  Future<void> openAutoStartSettings() => _maintenance.openAutoStartSettings();

  Future<void> openInstallSettings() => _maintenance.openInstallSettings();

  Future<bool> authenticate(String reason) => _maintenance.authenticate(reason);

  Future<String?> consumeQuickAction() => _maintenance.consumeQuickAction();

  void setQuickActionHandler(void Function(String action)? handler) =>
      _maintenance.setQuickActionHandler(handler);

  Future<void> setScreenProtection(bool enabled) =>
      _maintenance.setScreenProtection(enabled);

  Future<void> updateSystemWidget({required bool recording}) => _maintenance
      .updateWidget(pendingCount: pendingCount, recording: recording);

  Future<String> checkAndInstallUpdate() async {
    final connection = _connection;
    if (connection == null) throw StateError('请先连接主Mac');
    final status = await _maintenance.setupStatus();
    final update = await _syncClient.checkForUpdate(
      connection,
      currentVersionCode: status.appVersionCode,
    );
    if (update == null) return '当前已经是最新版';
    await _maintenance.installUpdate(
      url: update.downloadUrl,
      sha256: update.sha256,
      sizeBytes: update.sizeBytes,
      versionCode: update.versionCode,
    );
    return '已校验${update.versionName}，请在系统页面确认覆盖安装';
  }

  Map<String, Object?> diagnosticsSnapshot() => {
    'recordCount': entries.length,
    'trashCount': trashedEntries.length,
    'pendingCount': pendingCount,
    'failedCount': entries
        .where(
          (entry) =>
              entry.syncState == CaptureSyncState.failed ||
              entry.noteSyncError != null,
        )
        .length,
    'attachmentCount': entries.fold<int>(
      0,
      (total, entry) => total + entry.attachments.length,
    ),
    'paired': _connection != null,
    'syncPaused': _syncPaused,
  };

  Future<void> exportDiagnostics() =>
      _maintenance.exportDiagnostics(diagnosticsSnapshot());

  Future<void> syncPending() async {
    final connection = _connection;
    if (_syncing) {
      _syncRequested = true;
      return;
    }
    if (_syncPaused || connection == null || pendingCount == 0) return;
    _syncing = true;
    var lease = false;
    var networkHeld = false;
    try {
      if (!await canTransfer()) return;
      _retryTimer?.cancel();
      _retryTimer = null;
      _connectionError = null;
      notifyListeners();
      lease = await _store.tryAcquireLease(
        'sync',
        _leaseOwner,
        DateTime.now().toUtc().add(const Duration(minutes: 2)),
      );
      if (!lease) return;
      networkHeld = await _environment.acquireWifi();
      if (!networkHeld) return;
      var retryLater = false;
      final candidates =
          _entries
              .where(
                (entry) =>
                    !entry.isTrashed &&
                    (entry.syncState != CaptureSyncState.synced ||
                        entry.hasPendingNoteSync) &&
                    !entry.syncPaused,
              )
              .toList()
            ..sort((left, right) {
              if (left.priority != right.priority) {
                return left.priority ? -1 : 1;
              }
              final rank = _transferRank(left).compareTo(_transferRank(right));
              return rank != 0
                  ? rank
                  : left.createdAt.compareTo(right.createdAt);
            });
      for (final original in candidates) {
        if (!await canTransfer(
          attachments:
              original.attachments.isNotEmpty &&
              original.syncState != CaptureSyncState.synced,
        )) {
          _connectionError = '等待可用Wi-Fi或电量恢复';
          continue;
        }
        if (original.syncState == CaptureSyncState.synced) {
          _notesInFlight.add(original.id);
          try {
            final receipt = await _syncClient.appendNotes(connection, original);
            final latest =
                await _store.loadById(original.id) ??
                _entries.where((item) => item.id == original.id).firstOrNull ??
                original;
            await replace(
              latest.copyWith(
                notesSyncedRevision: receipt.notesRevision,
                noteSyncError: null,
              ),
            );
          } catch (error) {
            final syncError = error is MobileSyncException
                ? error
                : MobileSyncException(error.toString());
            final latest =
                await _store.loadById(original.id) ??
                _entries.where((item) => item.id == original.id).firstOrNull ??
                original;
            await replace(latest.copyWith(noteSyncError: syncError.message));
            _connectionError = syncError.message;
            if (syncError.requiresPairing) {
              await _connectionStore.clear();
              _connection = null;
            } else {
              retryLater = true;
            }
            break;
          } finally {
            _notesInFlight.remove(original.id);
          }
          continue;
        }
        final totalBytes = original.attachments.fold<int>(
          0,
          (total, attachment) => total + attachment.sizeBytes,
        );
        if (!original.priority && totalBytes >= 10 * 1024 * 1024) {
          try {
            final power = await _powerStatusProvider.read();
            if (power.shouldPauseLargeTransfers) continue;
          } catch (_) {
            // 读取电量失败时不把可靠同步永久卡住。
          }
        }
        final attempted = original.copyWith(
          syncState: CaptureSyncState.syncing,
          attemptCount: original.attemptCount + 1,
          lastAttemptAt: DateTime.now().toUtc(),
          clearLastError: true,
        );
        await replace(attempted);
        try {
          final receipt = await _syncClient.upload(
            connection,
            attempted,
            shouldContinue: () => _shouldContinueUpload(attempted),
            onAttachmentProgress: (attachmentId, uploadedChunks) async {
              final latest = _entries
                  .where((item) => item.id == attempted.id)
                  .firstOrNull;
              if (latest == null) return;
              final persisted = await _store.loadById(attempted.id);
              final base = persisted ?? latest;
              final targetAttachment = base.attachments
                  .where((item) => item.id == attachmentId)
                  .firstOrNull;
              if (targetAttachment == null) return;
              final attachments = base.attachments
                  .map(
                    (attachment) => attachment.id == attachmentId
                        ? attachment.copyWith(
                            uploadedChunkIndexes: uploadedChunks,
                            clearLastError: true,
                          )
                        : attachment,
                  )
                  .toList();
              final checkpoint =
                  uploadedChunks.length == targetAttachment.chunkCount ||
                  uploadedChunks.length % 16 == 0;
              await replace(
                base.copyWith(attachments: attachments),
                persist: checkpoint,
              );
            },
          );
          final latest =
              await _store.loadById(attempted.id) ??
              _entries.where((item) => item.id == attempted.id).firstOrNull ??
              attempted;
          final synced = latest.copyWith(
            syncState: CaptureSyncState.synced,
            desktopCaptureId: receipt.desktopCaptureId,
            noteSyncError: null,
            clearLastError: true,
          );
          await replace(synced);
          if (synced.hasPendingNoteSync) _syncRequested = true;
        } catch (error) {
          if (error is MobileSyncPausedException) {
            final latest =
                await _store.loadById(attempted.id) ??
                _entries.where((item) => item.id == attempted.id).firstOrNull ??
                attempted;
            await replace(
              latest.copyWith(
                syncState: latest.syncPaused
                    ? CaptureSyncState.paused
                    : CaptureSyncState.pending,
              ),
            );
            break;
          }
          final syncError = error is MobileSyncException
              ? error
              : MobileSyncException(error.toString());
          final latest =
              await _store.loadById(attempted.id) ??
              _entries.where((item) => item.id == attempted.id).firstOrNull ??
              attempted;
          await replace(
            latest.copyWith(
              syncState: syncError.waitingForMac
                  ? CaptureSyncState.waitingMac
                  : CaptureSyncState.failed,
              lastError: syncError.message,
            ),
          );
          _connectionError = syncError.message;
          if (syncError.requiresPairing) {
            await _connectionStore.clear();
            _connection = null;
            break;
          }
          retryLater = true;
          // 同一批记录共用一个Mac连接；首条网络失败后继续逐条等待只会放大延迟。
          break;
        }
      }
      if (retryLater &&
          _connection != null &&
          _scheduleRetries &&
          _foreground) {
        final largestAttempt = _entries
            .where(
              (entry) =>
                  entry.syncState == CaptureSyncState.failed ||
                  entry.syncState == CaptureSyncState.waitingMac,
            )
            .fold<int>(1, (value, entry) => max(value, entry.attemptCount));
        final baseSeconds = min(
          21600,
          30 * pow(2, min(largestAttempt, 10)).toInt(),
        );
        final seconds = _entries.any((entry) => entry.noteSyncError != null)
            ? max(30, baseSeconds)
            : baseSeconds;
        _retryTimer = Timer(
          Duration(seconds: seconds),
          () => unawaited(syncPending()),
        );
      }
    } finally {
      if (networkHeld) await _environment.releaseWifi();
      if (lease) await _store.releaseLease('sync', _leaseOwner);
      _syncing = false;
      notifyListeners();
      if (_syncRequested && _foreground) {
        _syncRequested = false;
        unawaited(syncPending());
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _draftSaveTimer?.cancel();
    unawaited(flushDraft());
    super.dispose();
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  Future<void> replace(CaptureEntry entry, {bool persist = true}) async {
    final index = _entries.indexWhere((item) => item.id == entry.id);
    if (index < 0) return;
    final next = List<CaptureEntry>.of(_entries)
      ..[index] = entry.copyWith(updatedAt: DateTime.now().toUtc());
    if (persist) await _store.upsert(next[index]);
    _entries = next;
    notifyListeners();
  }

  String _uuidV4() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  int _transferRank(CaptureEntry entry) {
    if (entry.attachments.isEmpty) return 0;
    final totalBytes = entry.attachments.fold<int>(
      0,
      (total, attachment) => total + attachment.sizeBytes,
    );
    if (totalBytes < 10 * 1024 * 1024) return 1;
    final hasVideo = entry.attachments.any(
      (attachment) => attachment.kind == MobileAttachmentKind.video,
    );
    return hasVideo ? 3 : 2;
  }

  Future<bool> _shouldContinueUpload(CaptureEntry uploading) async {
    if (!await canTransfer(attachments: uploading.attachments.isNotEmpty)) {
      return false;
    }
    if (_syncPaused || await _store.loadSyncPaused()) return false;
    if (!await _store.tryAcquireLease(
      'sync',
      _leaseOwner,
      DateTime.now().toUtc().add(const Duration(minutes: 2)),
    )) {
      return false;
    }
    final persistedEntries = await _store.load();
    final latest = persistedEntries
        .where((item) => item.id == uploading.id)
        .firstOrNull;
    if (latest == null || latest.syncPaused || latest.isTrashed) return false;
    final totalBytes = latest.attachments.fold<int>(
      0,
      (total, attachment) => total + attachment.sizeBytes,
    );
    if (!latest.priority && totalBytes >= 10 * 1024 * 1024) {
      try {
        if ((await _powerStatusProvider.read()).shouldPauseLargeTransfers) {
          return false;
        }
      } catch (_) {
        // 无法读取电量时继续，不能把队列永久卡死。
      }
    }
    final currentRank = _transferRank(latest);
    return !persistedEntries.any((entry) {
      if (entry.id == latest.id ||
          entry.isTrashed ||
          entry.syncPaused ||
          entry.syncState == CaptureSyncState.synced) {
        return false;
      }
      if (entry.priority != latest.priority) return entry.priority;
      return _transferRank(entry) < currentRank;
    });
  }

  Future<String> _captureIdForShare(String shareId) async {
    final digest = await Sha256().hash(
      utf8.encode('ly-creator-share-v1\n$shareId'),
    );
    final hex = digest.bytes
        .take(16)
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return 'share-$hex';
  }

  String? _boundedText(String? value, int maximumLength) {
    final clean = value?.trim();
    if (clean == null || clean.isEmpty) return null;
    if (clean.length <= maximumLength) return clean;
    final kept = <int>[];
    var codeUnits = 0;
    for (final rune in clean.runes) {
      final nextUnits = rune > 0xffff ? 2 : 1;
      if (codeUnits + nextUnits > maximumLength) break;
      kept.add(rune);
      codeUnits += nextUnits;
    }
    return String.fromCharCodes(kept);
  }

  Future<void> _deletePermanently(CaptureEntry entry) async {
    if (entry.hasLocalAttachmentCopies) {
      await _maintenance.deletePrivateCopies(entry.attachments);
    }
    await _store.deleteById(entry.id);
    _entries = _entries.where((item) => item.id != entry.id).toList();
    notifyListeners();
  }

  Future<void> _purgeExpiredTrash() async {
    final cutoff = DateTime.now().toUtc().subtract(const Duration(days: 30));
    final expired = _entries
        .where(
          (entry) =>
              entry.deletedAt != null && entry.deletedAt!.isBefore(cutoff),
        )
        .toList();
    for (final entry in expired) {
      await _deletePermanently(entry);
    }
  }

  String? _validSourceUrl(String? value) {
    final clean = value?.trim();
    if (clean == null || clean.isEmpty || clean.length > 4096) return null;
    final parsed = Uri.tryParse(clean);
    if (parsed == null ||
        (parsed.scheme != 'http' && parsed.scheme != 'https') ||
        parsed.host.isEmpty) {
      return null;
    }
    return clean;
  }
}
