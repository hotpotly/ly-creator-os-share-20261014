import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/full_work_log_editor.dart';
import 'package:ly_creator_capture/src/workspace/full_work_log_view.dart';
import 'package:ly_creator_capture/src/workspace/workspace_full_models.dart';

WorkspaceFullRecord workLog({
  String day = '2026-10-03',
  Object? total = 30,
  num self = 10,
  num ai = 5,
  num other = 15,
  bool deleted = false,
  bool writable = true,
  bool omitTotal = false,
  Map<String, dynamic> extra = const {},
}) => WorkspaceFullRecord({
  'kind': 'work_log',
  'id': day,
  'localRevision': 4,
  'remoteRevision': 1,
  'deleted': deleted,
  'writable': writable,
  'metadata': {
    'scope': 'work_log',
    'read': true,
    'write': writable,
    'deletable': writable,
    'editableFields': writable ? ['totalMinutes'] : <String>[],
  },
  'json': jsonEncode({
    'day': day,
    if (!omitTotal) 'totalMinutes': total,
    'selfMediaMinutes': self,
    'aiMinutes': ai,
    'otherWorkMinutes': other,
    'updatedAt': '',
    ...extra,
  }),
});

void main() {
  test('absent deleted zero and unknown records remain distinct', () {
    expect(fullWorkLogReading(null).label, '未记录');
    expect(fullWorkLogReading(workLog(deleted: true)).label, '未记录');
    expect(fullWorkLogReading(workLog(total: 0)).label, '0小时');
    final unknown = fullWorkLogReading(workLog(extra: {'future': 1}));
    expect(unknown.label, '不可统计');
    expect(unknown.recorded, true);
    expect(unknown.minutes, null);
  });
  test(
    'explicit total wins and legacy missing total falls back to categories',
    () {
      expect(fullWorkLogReading(workLog(total: 120)).minutes, 120);
      expect(fullWorkLogReading(workLog(total: null)).minutes, 30);
      expect(fullWorkLogReading(workLog(omitTotal: true)).minutes, 30);
      expect(
        fullWorkLogReading(
          workLog(total: null, self: 0, ai: 0, other: 0),
        ).label,
        '0小时',
      );
    },
  );
  test('fractional and over24h history is not clamped or rounded', () {
    expect(fullWorkLogReading(workLog(total: 90.5)).label, '1小时30.5分钟');
    expect(
      fullWorkLogReading(
        workLog(total: null, self: 1440, ai: 1440, other: 1440),
      ).label,
      '72小时',
    );
    expect(formatFullWorkMinutes(-0.5), '-0.5分钟');
    expect(formatFullWorkMinutes(1440), '24小时');
    expect(formatFullWorkMinutes(61), '1小时1分钟');
    expect(formatFullWorkMinutes(60), '1小时');
    expect(formatFullWorkMinutes(1), '1分钟');
    expect(formatFullWorkMinutes(105.5), '1小时45.5分钟');
    expect(formatFullWorkMinutes(60.1), '1小时0.1分钟');
    expect(formatFullWorkMinutes(1e-7), '0.0000001分钟');
  });
  test(
    'empty period has no zero total and includes its full coverage denominator',
    () {
      final summary = fullWorkLogSummary([], ['2026-10-03', '2026-10-04']);
      expect(summary.label, '未记录');
      expect(summary.minutes, null);
      expect(summary.recordedCount, 0);
      expect(summary.readings.length, 2);
    },
  );
  test('zero period and partial recorded periods retain real totals', () {
    final zero = fullWorkLogSummary(
      [workLog(total: 0)],
      ['2026-10-03', '2026-10-04'],
    );
    expect(zero.label, '0小时');
    expect(zero.recordedCount, 1);
    final sum = fullWorkLogSummary(
      [workLog(total: 90.5), workLog(day: '2026-10-04', total: 30.5)],
      ['2026-10-03', '2026-10-04', '2026-10-05'],
    );
    expect(sum.minutes, 121);
    expect(sum.label, '2小时1分钟');
    expect(sum.recordedCount, 2);
  });
  test(
    'unknown data makes period non-statistical rather than silently zero',
    () {
      final summary = fullWorkLogSummary(
        [workLog(total: 60), workLog(day: '2026-10-04', total: 'bad')],
        ['2026-10-03', '2026-10-04'],
      );
      expect(summary.label, '不可统计');
      expect(summary.recordedCount, 2);
      expect(summary.unknownCount, 1);
      expect(summary.minutes, null);
    },
  );
  test(
    'safe writable tombstone may be supplemented but readonly or unknown cannot',
    () {
      final deleted = workLog(deleted: true);
      expect(deleted.writable, false);
      expect(fullWorkLogCanWrite(deleted), true);
      expect(fullWorkLogCanWrite(workLog(writable: false)), false);
      expect(fullWorkLogCanWrite(workLog(extra: {'future': true})), false);
    },
  );
  test(
    'new edits are integer totals0 to1440 only with no server or category fields',
    () {
      expect(fullWorkLogCommand('2026-10-03', '0'), {
        'day': '2026-10-03',
        'minutes': 0,
      });
      expect(fullWorkLogCommand('2026-10-03', '1440'), {
        'day': '2026-10-03',
        'minutes': 1440,
      });
      for (final invalid in ['', ' ', '12.5', '-1', '1441', 'NaN', '1e3']) {
        expect(
          () => fullWorkLogCommand('2026-10-03', invalid),
          throwsFormatException,
        );
      }
      expect(
        () => fullWorkLogCommand('2026-02-30', '10'),
        throwsFormatException,
      );
    },
  );
}
