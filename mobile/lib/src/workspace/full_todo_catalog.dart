import 'workspace_full_models.dart';

class FullTodoCatalog {
  FullTodoCatalog(Iterable<WorkspaceFullRecord> records) {
    for (final record in records) {
      if (record.deleted || !record.supported) continue;
      if (record.kind == 'project_catalog') _projects[record.id] = record;
      if (record.kind == 'todo_preferences' && record.id == 'workspace') {
        final body = record.body;
        _labels = Map<String, String>.unmodifiable(
          Map<String, String>.from(body['todoCategoryLabels'] as Map),
        );
        _colors = Map<String, String>.unmodifiable(
          Map<String, String>.from(body['todoCategoryColors'] as Map),
        );
      }
    }
  }

  final _projects = <String, WorkspaceFullRecord>{};
  Map<String, String> _labels = const {};
  Map<String, String> _colors = const {};
  Map<String, String> get labels => _labels;
  Map<String, String> get colors => _colors;

  List<WorkspaceFullRecord> get projects =>
      _projects.values.where(_selectable).toList();

  bool _selectable(WorkspaceFullRecord record) {
    final body = record.body;
    return body['trashedAt'] == null &&
        body['ledgerOnly'] != true &&
        !['archived', 'published', 'paused'].contains(body['status']) &&
        !['archived', 'shelved', 'completed'].contains(body['topicStageRole']);
  }

  String? projectLabel(String? id) =>
      id == null ? null : _projects[id]?.title ?? id;

  String? stageLabel(String? key) =>
      key == null ? null : _stageLabels[key] ?? key;

  List<String> stages(String? projectId) =>
      !projects.any((record) => record.id == projectId)
      ? const []
      : [
          for (final stage
              in _projects[projectId]?.body['stages'] as List? ?? [])
            if (stage['enabled'] == true &&
                _stageLabels.containsKey(stage['key']))
              stage['key'] as String,
        ];

  static const _stageLabels = {
    'materials': '资料',
    'outline': '大纲',
    'script': '文案',
    'production': '制作',
    'shooting': '拍摄',
    'editing': '剪辑',
    'postproduction': '后期',
    'publishing': '发布',
    'versions': '版本',
  };
}
