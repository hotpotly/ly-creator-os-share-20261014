import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_models.dart';

void main() {
  test('shared completion-day fixtures use local calendar dates', () {
    final fixture =
        jsonDecode(
              File(
                '../shared-fixtures/workspace-sync-v1.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final value in fixture['dates'] as List) {
      expect(
        workspaceCompletedDay(
          value['utc'] as String,
          offsetMinutes: value['offsetMinutes'] as int,
        ),
        value['day'],
      );
    }
  });
}
