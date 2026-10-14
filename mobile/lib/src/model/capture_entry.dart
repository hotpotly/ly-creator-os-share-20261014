enum CaptureHint { auto, inspiration, topic }

enum CaptureSyncState { pending, syncing, paused, waitingMac, synced, failed }

enum MobileAttachmentKind { image, video, audio, pdf, word, file }

const mobileAttachmentChunkBytes = 256 * 1024;
const mobileCaptureTitleMaxRunes = 60;
const _unchangedCaptureField = Object();

class MobileAttachment {
  const MobileAttachment({
    required this.id,
    required this.localPath,
    required this.name,
    required this.mimeType,
    required this.sizeBytes,
    required this.sha256,
    required this.kind,
    required this.chunkCount,
    this.encryptedAtRest = false,
    this.sourceModifiedAt,
    this.previewAttachmentId,
    this.previewLocalPath,
    this.uploadedChunkIndexes = const [],
    this.lastError,
  });

  final String id;
  final String localPath;
  final String name;
  final String mimeType;
  final int sizeBytes;
  final String sha256;
  final MobileAttachmentKind kind;
  final int chunkCount;
  final bool encryptedAtRest;
  final DateTime? sourceModifiedAt;
  final String? previewAttachmentId;
  final String? previewLocalPath;
  final List<int> uploadedChunkIndexes;
  final String? lastError;

  MobileAttachment copyWith({
    List<int>? uploadedChunkIndexes,
    String? lastError,
    bool clearLastError = false,
  }) => MobileAttachment(
    id: id,
    localPath: localPath,
    name: name,
    mimeType: mimeType,
    sizeBytes: sizeBytes,
    sha256: sha256,
    kind: kind,
    chunkCount: chunkCount,
    encryptedAtRest: encryptedAtRest,
    sourceModifiedAt: sourceModifiedAt,
    previewAttachmentId: previewAttachmentId,
    previewLocalPath: previewLocalPath,
    uploadedChunkIndexes: uploadedChunkIndexes ?? this.uploadedChunkIndexes,
    lastError: clearLastError ? null : lastError ?? this.lastError,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'localPath': localPath,
    'name': name,
    'mimeType': mimeType,
    'sizeBytes': sizeBytes,
    'sha256': sha256,
    'kind': kind.name,
    'chunkCount': chunkCount,
    'encryptedAtRest': encryptedAtRest,
    'sourceModifiedAt': sourceModifiedAt?.toUtc().toIso8601String(),
    'previewAttachmentId': previewAttachmentId,
    'previewLocalPath': previewLocalPath,
    'uploadedChunkIndexes': uploadedChunkIndexes,
    'lastError': lastError,
  };

  static MobileAttachment fromJson(Map<String, Object?> json) {
    final sizeBytes = (json['sizeBytes'] as num?)?.toInt() ?? 0;
    return MobileAttachment(
      id: json['id']! as String,
      localPath: json['localPath']! as String,
      name: json['name']! as String,
      mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
      sizeBytes: sizeBytes,
      sha256: json['sha256']! as String,
      kind: MobileAttachmentKind.values.firstWhere(
        (value) => value.name == json['kind'],
        orElse: () => MobileAttachmentKind.file,
      ),
      chunkCount:
          (json['chunkCount'] as num?)?.toInt() ??
          ((sizeBytes + mobileAttachmentChunkBytes - 1) ~/
              mobileAttachmentChunkBytes),
      encryptedAtRest: json['encryptedAtRest'] as bool? ?? false,
      sourceModifiedAt: DateTime.tryParse(
        json['sourceModifiedAt'] as String? ?? '',
      )?.toUtc(),
      previewAttachmentId: json['previewAttachmentId'] as String?,
      previewLocalPath: json['previewLocalPath'] as String?,
      uploadedChunkIndexes:
          (json['uploadedChunkIndexes'] as List?)
              ?.whereType<num>()
              .map((value) => value.toInt())
              .toList() ??
          const [],
      lastError: json['lastError'] as String?,
    );
  }
}

class CaptureEntry {
  const CaptureEntry({
    required this.id,
    required this.content,
    required this.hint,
    required this.createdAt,
    required this.syncState,
    this.title = '',
    this.updatedAt,
    this.attachments = const [],
    this.sourceShareId,
    this.sourceApp,
    this.sourceTitle,
    this.sourceUrl,
    this.notes = '',
    this.notesRevision = 0,
    this.notesSyncedRevision = 0,
    this.noteSyncError,
    this.recordingMarkersMs = const [],
    this.recordingInterruptionReason,
    this.priority = false,
    this.syncPaused = false,
    this.attemptCount = 0,
    this.lastAttemptAt,
    this.lastError,
    this.desktopCaptureId,
    this.deletedAt,
    this.localCopyRemovedAt,
  });

  final String id;
  final String title;
  final String content;
  final CaptureHint hint;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final CaptureSyncState syncState;
  final List<MobileAttachment> attachments;
  final String? sourceShareId;
  final String? sourceApp;
  final String? sourceTitle;
  final String? sourceUrl;
  final String notes;
  final int notesRevision;
  final int notesSyncedRevision;
  final String? noteSyncError;
  final List<int> recordingMarkersMs;
  final String? recordingInterruptionReason;
  final bool priority;
  final bool syncPaused;
  final int attemptCount;
  final DateTime? lastAttemptAt;
  final String? lastError;
  final String? desktopCaptureId;
  final DateTime? deletedAt;
  final DateTime? localCopyRemovedAt;

  bool get hasPendingNoteSync =>
      syncState == CaptureSyncState.synced &&
      notesRevision > notesSyncedRevision;
  bool get isTrashed => deletedAt != null;
  bool get hasLocalAttachmentCopies =>
      attachments.isNotEmpty && localCopyRemovedAt == null;

  String get displayTitle {
    final saved = title.trim();
    return saved.isNotEmpty
        ? saved
        : localCaptureTitle(
            content: content,
            attachments: attachments,
            createdAt: createdAt,
          );
  }

  double? get attachmentUploadProgress {
    final totalChunks = attachments.fold<int>(
      0,
      (total, attachment) => total + attachment.chunkCount,
    );
    if (totalChunks <= 0) return null;
    final uploadedChunks = attachments.fold<int>(
      0,
      (total, attachment) => total + attachment.uploadedChunkIndexes.length,
    );
    return (uploadedChunks / totalChunks).clamp(0, 1);
  }

  CaptureEntry copyWith({
    String? title,
    String? content,
    String? notes,
    int? notesRevision,
    int? notesSyncedRevision,
    Object? noteSyncError = _unchangedCaptureField,
    List<int>? recordingMarkersMs,
    String? recordingInterruptionReason,
    bool? priority,
    bool? syncPaused,
    CaptureSyncState? syncState,
    DateTime? updatedAt,
    List<MobileAttachment>? attachments,
    int? attemptCount,
    DateTime? lastAttemptAt,
    String? lastError,
    bool clearLastError = false,
    String? desktopCaptureId,
    Object? deletedAt = _unchangedCaptureField,
    Object? localCopyRemovedAt = _unchangedCaptureField,
  }) {
    return CaptureEntry(
      id: id,
      title: title ?? this.title,
      content: content ?? this.content,
      hint: hint,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      syncState: syncState ?? this.syncState,
      attachments: attachments ?? this.attachments,
      sourceShareId: sourceShareId,
      sourceApp: sourceApp,
      sourceTitle: sourceTitle,
      sourceUrl: sourceUrl,
      notes: notes ?? this.notes,
      notesRevision: notesRevision ?? this.notesRevision,
      notesSyncedRevision: notesSyncedRevision ?? this.notesSyncedRevision,
      noteSyncError: identical(noteSyncError, _unchangedCaptureField)
          ? this.noteSyncError
          : noteSyncError as String?,
      recordingMarkersMs: recordingMarkersMs ?? this.recordingMarkersMs,
      recordingInterruptionReason:
          recordingInterruptionReason ?? this.recordingInterruptionReason,
      priority: priority ?? this.priority,
      syncPaused: syncPaused ?? this.syncPaused,
      attemptCount: attemptCount ?? this.attemptCount,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
      lastError: clearLastError ? null : lastError ?? this.lastError,
      desktopCaptureId: desktopCaptureId ?? this.desktopCaptureId,
      deletedAt: identical(deletedAt, _unchangedCaptureField)
          ? this.deletedAt
          : deletedAt as DateTime?,
      localCopyRemovedAt: identical(localCopyRemovedAt, _unchangedCaptureField)
          ? this.localCopyRemovedAt
          : localCopyRemovedAt as DateTime?,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'content': content,
    'hint': hint.name,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'updatedAt': updatedAt?.toUtc().toIso8601String(),
    'syncState': syncState.name,
    'attachments': attachments.map((item) => item.toJson()).toList(),
    'sourceShareId': sourceShareId,
    'sourceApp': sourceApp,
    'sourceTitle': sourceTitle,
    'sourceUrl': sourceUrl,
    'notes': notes,
    'notesRevision': notesRevision,
    'notesSyncedRevision': notesSyncedRevision,
    'noteSyncError': noteSyncError,
    'recordingMarkersMs': recordingMarkersMs,
    'recordingInterruptionReason': recordingInterruptionReason,
    'priority': priority,
    'syncPaused': syncPaused,
    'attemptCount': attemptCount,
    'lastAttemptAt': lastAttemptAt?.toUtc().toIso8601String(),
    'lastError': lastError,
    'desktopCaptureId': desktopCaptureId,
    'deletedAt': deletedAt?.toUtc().toIso8601String(),
    'localCopyRemovedAt': localCopyRemovedAt?.toUtc().toIso8601String(),
  };

  static CaptureEntry fromJson(Map<String, Object?> json) {
    final state = CaptureSyncState.values.firstWhere(
      (value) => value.name == json['syncState'],
      orElse: () => CaptureSyncState.pending,
    );
    return CaptureEntry(
      id: json['id']! as String,
      // 兼容旧版本曾把完整附件文件名写进标题的记录。读取后先收敛到
      // Mac协议上限，失败队列升级App后即可直接重试，不要求用户手改。
      title: boundedCaptureTitle(json['title'] as String? ?? ''),
      content: json['content'] as String? ?? '',
      hint: CaptureHint.values.firstWhere(
        (value) => value.name == json['hint'],
        orElse: () => CaptureHint.auto,
      ),
      createdAt: DateTime.parse(json['createdAt']! as String),
      updatedAt: json['updatedAt'] is String
          ? DateTime.parse(json['updatedAt']! as String)
          : null,
      // App被结束时无法确认发送是否完成；重启后一律回到待同步。
      syncState: state == CaptureSyncState.syncing
          ? CaptureSyncState.pending
          : state,
      attachments:
          (json['attachments'] as List?)
              ?.whereType<Map>()
              .map(
                (entry) =>
                    MobileAttachment.fromJson(entry.cast<String, Object?>()),
              )
              .toList() ??
          const [],
      sourceShareId: json['sourceShareId'] as String?,
      sourceApp: json['sourceApp'] as String?,
      sourceTitle: json['sourceTitle'] as String?,
      sourceUrl: json['sourceUrl'] as String?,
      notes: json['notes'] as String? ?? '',
      notesRevision: (json['notesRevision'] as num?)?.toInt() ?? 0,
      notesSyncedRevision: (json['notesSyncedRevision'] as num?)?.toInt() ?? 0,
      noteSyncError: json['noteSyncError'] as String?,
      recordingMarkersMs:
          (json['recordingMarkersMs'] as List?)
              ?.whereType<num>()
              .map((value) => value.toInt())
              .toList() ??
          const [],
      recordingInterruptionReason:
          json['recordingInterruptionReason'] as String?,
      priority: json['priority'] as bool? ?? false,
      syncPaused: json['syncPaused'] as bool? ?? false,
      attemptCount: (json['attemptCount'] as num?)?.toInt() ?? 0,
      lastAttemptAt: json['lastAttemptAt'] is String
          ? DateTime.parse(json['lastAttemptAt']! as String)
          : null,
      lastError: json['lastError'] as String?,
      desktopCaptureId: json['desktopCaptureId'] as String?,
      deletedAt: DateTime.tryParse(json['deletedAt'] as String? ?? '')?.toUtc(),
      localCopyRemovedAt: DateTime.tryParse(
        json['localCopyRemovedAt'] as String? ?? '',
      )?.toUtc(),
    );
  }
}

String localCaptureTitle({
  required String content,
  required List<MobileAttachment> attachments,
  required DateTime createdAt,
}) {
  final firstParagraph = content
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split(RegExp(r'\n\s*\n|\n'))
      .map((value) => value.trim())
      .firstWhere((value) => value.isNotEmpty, orElse: () => '');
  final clean = firstParagraph
      .replaceAll(RegExp(r'https?://\S+', caseSensitive: false), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (clean.isNotEmpty) {
    final clauses = clean
        .split(RegExp(r'[。！？!?；;]'))
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty);
    var candidate = clauses.firstOrNull ?? clean;
    const emptyPrefixes = ['今天想到', '我想到', '突然想到', '记录一下', '记一下'];
    for (final prefix in emptyPrefixes) {
      if (candidate.startsWith(prefix) && candidate.length > prefix.length) {
        candidate = candidate.substring(prefix.length).trim();
      }
    }
    final characters = candidate.runes.toList();
    return String.fromCharCodes(
      characters.length > 20 ? characters.take(20) : characters,
    );
  }
  if (attachments.isNotEmpty) {
    if (attachments.length == 1) {
      return boundedCaptureTitle(attachments.first.name);
    }
    return boundedCaptureTitle(
      '${attachments.first.name}等${attachments.length}个附件',
    );
  }
  final local = createdAt.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '记录·${two(local.month)}月${two(local.day)}日${two(local.hour)}:${two(local.minute)}';
}

String boundedCaptureTitle(String value) {
  final clean = value.trim();
  if (clean.isEmpty) return '';
  final characters = clean.runes.toList();
  return String.fromCharCodes(
    characters.length > mobileCaptureTitleMaxRunes
        ? characters.take(mobileCaptureTitleMaxRunes)
        : characters,
  );
}
