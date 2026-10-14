import 'dart:math';

const workspaceCategories = {
  'self_media': '自媒体',
  'ai': 'AI',
  'life': '生活',
  'other_work': '健康',
};

String workspaceId() {
  final random = Random.secure();
  final bytes = List.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

String workspaceDay(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

DateTime parseWorkspaceDay(String day) {
  final value = DateTime.tryParse(day);
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(day) ||
      value == null ||
      workspaceDay(value) != day ||
      value.year < 1900 ||
      value.year > 2199) {
    throw const FormatException('日期无效');
  }
  return value;
}

String? workspaceCompletedDay(String? timestamp, {int? offsetMinutes}) {
  if (timestamp == null) return null;
  final date = DateTime.tryParse(timestamp);
  if (date == null) return null;
  return workspaceDay(
    offsetMinutes == null
        ? date.toLocal()
        : date.toUtc().add(Duration(minutes: offsetMinutes)),
  );
}

String reviewPeriodId(DateTime date, bool monthly) {
  final start = monthly
      ? DateTime(date.year, date.month)
      : DateTime(date.year, date.month, date.day - date.weekday + 1);
  return '${monthly ? 'monthly' : 'weekly'}:${workspaceDay(start)}';
}

class WorkspaceRecord {
  WorkspaceRecord({
    required this.kind,
    required this.id,
    required Map<String, dynamic> data,
    this.revision = 0,
    this.deleted = false,
    Map<String, dynamic> metadata = const {},
    bool allowHistoricalValues = false,
  }) : data = Map.unmodifiable(data),
       metadata = Map.unmodifiable(metadata),
       _allowHistoricalValues = allowHistoricalValues {
    if (!['todo', 'review_draft', 'work_log'].contains(kind) ||
        id.isEmpty ||
        revision < 0) {
      throw const FormatException('工作区记录无效');
    }
    final fields = {
      'todo': {'title', 'category', 'plannedDate', 'completedAt'},
      'review_draft': {'goalsText', 'bodyText'},
      'work_log': {'minutes'},
    }[kind]!;
    if (data.keys.any((key) => !fields.contains(key)) ||
        !fields.every(data.containsKey)) {
      throw const FormatException('工作区字段无效');
    }
    switch (kind) {
      case 'todo':
        if (!RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        ).hasMatch(id)) {
          throw const FormatException('待办ID无效');
        }
        final title = data['title'];
        if (title is! String ||
            title.trim().isEmpty ||
            title.length > (allowHistoricalValues ? 100000 : 300) ||
            !workspaceCategories.containsKey(data['category'])) {
          throw const FormatException('待办标题或分类无效');
        }
        if (data['plannedDate'] != null) {
          parseWorkspaceDay(data['plannedDate'] as String);
        }
        if (data['completedAt'] != null && (!_validUtc(data['completedAt']))) {
          throw const FormatException('完成时间无效');
        }
        break;
      case 'review_draft':
        final parts = id.split(':');
        if (parts.length != 2 || !['weekly', 'monthly'].contains(parts.first)) {
          throw const FormatException('复盘周期无效');
        }
        final day = parseWorkspaceDay(parts.last);
        if (reviewPeriodId(day, parts.first == 'monthly') != id) {
          throw const FormatException('复盘周期无效');
        }
        for (final key in ['goalsText', 'bodyText']) {
          if (data[key] is! String || (data[key] as String).length > 100000) {
            throw const FormatException('复盘内容过长或格式无效');
          }
        }
        break;
      case 'work_log':
        parseWorkspaceDay(id);
        final minutes = data['minutes'];
        if (minutes != null &&
            (minutes is! int ||
                minutes < 0 ||
                minutes > (allowHistoricalValues ? 4320 : 1440))) {
          throw const FormatException('每日投入须在0至1440分钟内');
        }
    }
  }

  final String kind;
  final String id;
  final int revision;
  final bool deleted;
  final Map<String, dynamic> data;
  final Map<String, dynamic> metadata;
  final bool _allowHistoricalValues;

  WorkspaceRecord copy({
    Map<String, dynamic>? data,
    Map<String, dynamic>? metadata,
    int? revision,
    bool? deleted,
  }) => WorkspaceRecord(
    kind: kind,
    id: id,
    data: data ?? this.data,
    revision: revision ?? this.revision,
    deleted: deleted ?? this.deleted,
    metadata: metadata ?? this.metadata,
    allowHistoricalValues: _allowHistoricalValues,
  );

  Map<String, dynamic> toJson() => {
    'kind': kind,
    'id': id,
    'revision': revision,
    'deleted': deleted,
    'data': data,
    'metadata': metadata,
  };

  factory WorkspaceRecord.fromJson(Map<String, dynamic> json) =>
      WorkspaceRecord(
        kind: json['kind'] as String,
        id: json['id'] as String,
        revision: json['revision'] as int,
        deleted: json['deleted'] as bool,
        data: Map<String, dynamic>.from(json['data'] as Map),
        metadata: Map<String, dynamic>.from(json['metadata'] as Map? ?? {}),
        allowHistoricalValues: true,
      );

  bool appearsOn(String day, String today) {
    if (kind != 'todo' || deleted) return false;
    final todo = metadata['todo'];
    if (todo is Map) {
      if (todo['dismissedAt'] != null) return false;
      final range = todo['dateRange'];
      if (range is Map &&
          range['startDate'] is String &&
          range['endDate'] is String) {
        return day.compareTo(range['startDate'] as String) >= 0 &&
            day.compareTo(range['endDate'] as String) <= 0;
      }
    }
    final planned = data['plannedDate'];
    if (planned != null) return planned == day;
    final completed = data['completedAt'];
    return completed == null
        ? day == today
        : workspaceCompletedDay(completed as String) == day;
  }
}

class WorkspaceConflict implements Exception {
  const WorkspaceConflict();
  @override
  String toString() => '记录已被修改，草稿已保留；请重新打开后合并';
}

bool _validUtc(dynamic value) {
  if (value is! String ||
      !RegExp(
        r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$',
      ).hasMatch(value)) {
    return false;
  }
  final date = DateTime.tryParse(value);
  if (date == null || !date.isUtc) return false;
  final day = value.substring(0, 10);
  return workspaceDay(date) == day &&
      date.hour == int.parse(value.substring(11, 13)) &&
      date.minute == int.parse(value.substring(14, 16)) &&
      date.second == int.parse(value.substring(17, 19));
}
