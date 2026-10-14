import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_v2_client.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';

void main() {
  final fixture = workspaceV2Map(
    jsonDecode(
      File('../shared-fixtures/workspace-sync-v2.json').readAsStringSync(),
    ),
  );
  final crypto = workspaceV2Map(fixture['crypto']);
  final identity = workspaceV2Map(fixture['identity']);
  final requestVector = workspaceV2Map(crypto['request']);
  final responseVector = workspaceV2Map(crypto['response']);
  final connection = DesktopConnection(
    address: '127.0.0.1:1234',
    deviceId: identity['deviceId'] as String,
    serviceId: identity['serviceId'] as String,
    secretBase64: crypto['fakeSecretBase64'] as String,
    deviceName: 'fake-fixture',
  );
  Map<String, dynamic> sample(String schema) => workspaceV2Map(
    jsonDecode(
      jsonEncode(
        (fixture['cases'] as List).firstWhere(
          (v) => v['schema'] == schema && v['valid'] == true,
        )['value'],
      ),
    ),
  );
  final requestSchemas = {
    'capabilities': 'capabilitiesRequest',
    'sync': 'syncRequest',
    'snapshot.start': 'snapshotStart',
    'snapshot.page': 'snapshotPageRequest',
    'blob.start': 'blobStart',
    'blob.status': 'blobStatus',
    'blob.chunk': 'blobChunk',
    'blob.commit': 'blobCommitRequest',
    'blob.read': 'blobReadRequest',
  };
  final responseSchemas = {
    'capabilities': 'capabilitiesResponse',
    'sync': 'syncResponse',
    'snapshot.start': 'manifest',
    'snapshot.page': 'snapshotPageResponse',
    'blob.start': 'blobSession',
    'blob.status': 'blobSession',
    'blob.chunk': 'blobChunkAck',
    'blob.commit': 'blobCommitResponse',
    'blob.read': 'blobReadResponse',
  };

  test(
    'codec reproduces exact shared request and response AEAD vectors',
    () async {
      expect(
        base64Encode(
          await (await WorkspaceV2WireCodec.key(connection)).extractBytes(),
        ),
        crypto['keyBase64'],
      );
      for (final direction in ['request', 'response']) {
        final vector = workspaceV2Map(crypto[direction]);
        final expected = workspaceV2Map(vector['envelope']);
        final body = workspaceV2Map(jsonDecode(vector['plaintext'] as String));
        final envelope = await WorkspaceV2WireCodec.seal(
          connection,
          'sync',
          body,
          requestId: identity['requestId'] as String,
          counter: 7,
          direction: direction,
          nonce: base64Decode(expected['nonce'] as String),
        );
        expect(envelope, expected);
        expect(
          await WorkspaceV2WireCodec.open(
            connection,
            envelope,
            requestEnvelope: expected,
            direction: direction,
          ),
          body,
        );
      }
    },
  );

  test(
    'codec rejects reflection, altered headers, unknown fields and corrupted authentication',
    () async {
      final expected = workspaceV2Map(requestVector['envelope']);
      final response = workspaceV2Map(responseVector['envelope']);
      Future<Map<String, dynamic>> open(Map<String, dynamic> value) =>
          WorkspaceV2WireCodec.open(
            connection,
            value,
            requestEnvelope: expected,
          );
      expect(
        await open(response),
        workspaceV2Map(jsonDecode(responseVector['plaintext'] as String)),
      );
      for (final patch in [
        {'purpose': 'capabilities'},
        {'counter': 8},
        {'protocolVersion': 1},
        {'workspaceId': '77777777-7777-4777-8777-777777777777'},
        {'deviceId': '77777777-7777-4777-8777-777777777777'},
        {'requestId': '77777777-7777-4777-8777-777777777777'},
        {'tag': base64Encode(List.filled(16, 0))},
        {'extra': true},
      ]) {
        await expectLater(
          open({...response, ...patch}),
          throwsA(isA<WorkspaceV2Failure>()),
        );
      }
      await expectLater(open(expected), throwsA(isA<WorkspaceV2Failure>()));
    },
  );

  test(
    'actual plaintext bytes are bounded before parsing even with valid authentication',
    () async {
      final expected = workspaceV2Map(requestVector['envelope']);
      final base = workspaceV2Map(responseVector['envelope']);
      final box = await AesGcm.with256bits().encrypt(
        utf8.encode(
          '${responseVector['plaintext']}${' ' * workspaceV2PageBytes}',
        ),
        secretKey: await WorkspaceV2WireCodec.key(connection),
        aad: utf8.encode(workspaceV2Aad('response', base)),
      );
      await expectLater(
        WorkspaceV2WireCodec.open(connection, {
          ...base,
          'nonce': base64Encode(box.nonce),
          'ciphertext': base64Encode(box.cipherText),
          'tag': base64Encode(box.mac.bytes),
        }, requestEnvelope: expected),
        throwsA(isA<WorkspaceV2Failure>()),
      );
    },
  );

  for (final purpose in ['snapshot.start', 'snapshot.page']) {
    for (final status in [401, 403, 409, 410, 413]) {
      test(
        '$purpose HTTP$status has only the relevant recovery flag',
        () async {
          final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
          addTearDown(() => server.close(force: true));
          var requests = 0;
          server.listen((request) async {
            requests++;
            await request.drain<void>();
            request.response.statusCode = status;
            await request.response.close();
          });
          await expectLater(
            WorkspaceV2Client().request(
              connection.copyWithAddress('127.0.0.1:${server.port}'),
              purpose,
              sample(requestSchemas[purpose]!),
              reserveCounter: () async => 1,
            ),
            throwsA(
              isA<WorkspaceV2Failure>()
                  .having(
                    (e) => e.snapshotExpired,
                    'snapshotExpired',
                    purpose == 'snapshot.page' && status == 410,
                  )
                  .having(
                    (e) => e.uploadSessionExpired,
                    'uploadSessionExpired',
                    false,
                  )
                  .having((e) => e.tooLarge, 'tooLarge', status == 413)
                  .having(
                    (e) => e.requiresPairing,
                    'requiresPairing',
                    status == 401 || status == 403,
                  ),
            ),
          );
          expect(requests, 1);
        },
      );
    }
  }

  for (final purpose in requestSchemas.keys) {
    test(
      '$purpose uses private HTTP, persistent counter and authenticated response correlation',
      () async {
        final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
        addTearDown(() => server.close(force: true));
        final live = connection.copyWithAddress('127.0.0.1:${server.port}');
        final body = sample(requestSchemas[purpose]!);
        final responseBody = sample(responseSchemas[purpose]!);
        var reserved = 0, arrivals = 0;
        final client = WorkspaceV2Client();
        addTearDown(client.cancel);
        server.listen((request) async {
          arrivals++;
          expect(reserved, 1);
          expect(request.method, 'POST');
          expect(request.uri.path, workspaceV2Path(purpose));
          final raw = await utf8.decoder.bind(request).join();
          expect(raw, isNot(contains('推进一小步')));
          final envelope = workspaceV2Map(jsonDecode(raw));
          expect(envelope['counter'], 9);
          expect(
            await WorkspaceV2WireCodec.open(
              live,
              envelope,
              requestEnvelope: envelope,
              direction: 'request',
            ),
            body,
          );
          request.response.write(
            jsonEncode(
              await WorkspaceV2WireCodec.seal(
                live,
                purpose,
                responseBody,
                requestId: envelope['requestId'] as String,
                counter: 9,
                direction: 'response',
              ),
            ),
          );
          await request.response.close();
        });
        final result = await client.request(
          live,
          purpose,
          body,
          reserveCounter: () async {
            reserved++;
            return 9;
          },
          approvedPermissions: purpose == 'capabilities'
              ? (responseBody['permissions'] as List)
                    .map(workspaceV2Map)
                    .toList()
              : null,
          expectedBlob: purpose == 'blob.read'
              ? {
                  'sha256': responseBody['sha256'],
                  'byteLength': responseBody['byteLength'],
                  'mediaType': 'application/json',
                }
              : null,
        );
        expect(result, responseBody);
        expect(arrivals, 1);
      },
    );
  }

  test(
    'blob download rejects a self-consistent chunk from a different size reference',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final live = connection.copyWithAddress('127.0.0.1:${server.port}');
      final body = sample('blobReadRequest');
      final reply = sample('blobReadResponse');
      server.listen((request) async {
        final envelope = workspaceV2Map(
          jsonDecode(await utf8.decoder.bind(request).join()),
        );
        request.response.write(
          jsonEncode(
            await WorkspaceV2WireCodec.seal(
              live,
              'blob.read',
              reply,
              requestId: envelope['requestId'] as String,
              counter: 1,
              direction: 'response',
            ),
          ),
        );
        await request.response.close();
      });
      await expectLater(
        WorkspaceV2Client().request(
          live,
          'blob.read',
          body,
          reserveCounter: () async => 1,
          expectedBlob: {
            'sha256': reply['sha256'],
            'byteLength': (reply['byteLength'] as num) + 1,
            'mediaType': 'application/json',
          },
        ),
        throwsFormatException,
      );
    },
  );

  test(
    'invalid identity, unsupported endpoint or missing authorization never allocates a counter',
    () async {
      var counters = 0, clients = 0;
      final client = WorkspaceV2Client(
        httpClientFactory: () {
          clients++;
          return HttpClient();
        },
      );
      Future<int> reserve() async => ++counters;
      await expectLater(
        client.request(
          connection,
          'capabilities',
          sample('capabilitiesRequest'),
          reserveCounter: reserve,
        ),
        throwsFormatException,
      );
      await expectLater(
        client.request(
          connection,
          'blob.read',
          sample('blobReadRequest'),
          reserveCounter: reserve,
        ),
        throwsFormatException,
      );
      await expectLater(
        client.request(connection, 'sync', {
          ...sample('syncRequest'),
          'deviceId': '77777777-7777-4777-8777-777777777777',
        }, reserveCounter: reserve),
        throwsA(isA<WorkspaceV2Failure>()),
      );
      await expectLater(
        client.request(
          connection.copyWithAddress('8.8.8.8:80'),
          'sync',
          sample('syncRequest'),
          reserveCounter: reserve,
        ),
        throwsA(isA<Exception>()),
      );
      await expectLater(
        client.request(connection, 'unknown', {}, reserveCounter: reserve),
        throwsFormatException,
      );
      expect(counters, 0);
      expect(clients, 0);
    },
  );

  test(
    'counter failure and cancellation during allocation cannot create a socket',
    () async {
      var clients = 0;
      final client = WorkspaceV2Client(
        httpClientFactory: () {
          clients++;
          return HttpClient();
        },
      );
      await expectLater(
        client.request(
          connection,
          'sync',
          sample('syncRequest'),
          reserveCounter: () async => throw StateError('storage failure'),
        ),
        throwsStateError,
      );
      final allocation = Completer<int>();
      final allocating = Completer<void>();
      final request = client.request(
        connection,
        'sync',
        sample('syncRequest'),
        reserveCounter: () {
          allocating.complete();
          return allocation.future;
        },
      );
      await allocating.future;
      client.cancel();
      allocation.complete(12);
      await expectLater(
        request,
        throwsA(
          isA<WorkspaceV2Failure>().having(
            (e) => e.cancelled,
            'cancelled',
            true,
          ),
        ),
      );
      expect(clients, 0);
    },
  );

  test(
    'cancellation aborts an in-flight request without accepting a late response',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final arrived = Completer<void>();
      server.listen((request) async {
        await request.drain<void>();
        arrived.complete();
      });
      final client = WorkspaceV2Client();
      final request = client.request(
        connection.copyWithAddress('127.0.0.1:${server.port}'),
        'sync',
        sample('syncRequest'),
        reserveCounter: () async => 1,
      );
      final expectation = expectLater(
        request,
        throwsA(
          isA<WorkspaceV2Failure>().having(
            (e) => e.cancelled,
            'cancelled',
            true,
          ),
        ),
      );
      await arrived.future;
      client.cancel();
      await expectation;
    },
  );

  for (final status in [301, 401, 403, 404, 409, 410, 413, 500]) {
    test(
      'HTTP $status preserves data and never silently retries or downgrades',
      () async {
        final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
        addTearDown(() => server.close(force: true));
        var calls = 0;
        server.listen((request) async {
          calls++;
          await request.drain<void>();
          request.response.statusCode = status;
          request.response.headers.set('location', '/workspace/v1/sync');
          await request.response.close();
        });
        final client = WorkspaceV2Client();
        await expectLater(
          client.request(
            connection.copyWithAddress('127.0.0.1:${server.port}'),
            'sync',
            sample('syncRequest'),
            reserveCounter: () async => 1,
          ),
          throwsA(
            isA<WorkspaceV2Failure>()
                .having((e) => e.tooLarge, 'tooLarge', status == 413)
                .having(
                  (e) => e.uploadSessionExpired,
                  'uploadSessionExpired',
                  false,
                )
                .having(
                  (e) => e.unsupportedCapabilities,
                  'unsupportedCapabilities',
                  false,
                ),
          ),
        );
        expect(calls, 1);
      },
    );
  }

  for (final purpose in requestSchemas.keys) {
    test(
      'HTTP410 distinguishes upload and snapshot expiry for $purpose',
      () async {
        final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
        addTearDown(() => server.close(force: true));
        var calls = 0, counters = 0;
        server.listen((request) async {
          calls++;
          await request.drain<void>();
          request.response.statusCode = 410;
          await request.response.close();
        });
        final client = WorkspaceV2Client();
        final sent = sample(requestSchemas[purpose]!);
        final ref = sample('blobStart');
        await expectLater(
          client.request(
            connection.copyWithAddress('127.0.0.1:${server.port}'),
            purpose,
            sent,
            reserveCounter: () async => ++counters,
            approvedPermissions: purpose == 'capabilities'
                ? (sample('capabilitiesResponse')['permissions'] as List)
                      .map(workspaceV2Map)
                      .toList()
                : null,
            expectedBlob: purpose == 'blob.read'
                ? {
                    'sha256': ref['sha256'],
                    'byteLength': ref['byteLength'],
                    'mediaType': ref['mediaType'],
                  }
                : null,
          ),
          throwsA(
            isA<WorkspaceV2Failure>()
                .having(
                  (failure) => failure.uploadSessionExpired,
                  'uploadSessionExpired',
                  [
                    'blob.start',
                    'blob.status',
                    'blob.chunk',
                    'blob.commit',
                  ].contains(purpose),
                )
                .having(
                  (failure) => failure.snapshotExpired,
                  'snapshotExpired',
                  purpose == 'snapshot.page',
                )
                .having(
                  (failure) => failure.unsupportedCapabilities,
                  'unsupportedCapabilities',
                  false,
                )
                .having(
                  (failure) => failure.requiresPairing,
                  'requiresPairing',
                  false,
                ),
          ),
        );
        expect(calls, 1);
        expect(counters, 1);
      },
    );
  }

  for (final side in ['next', 'base']) {
    for (final status in [403, 410]) {
      test(
        'sync HTTP$status $side blob hint never retires an operation',
        () async {
          final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
          addTearDown(() => server.close(force: true));
          var calls = 0;
          server.listen((request) async {
            calls++;
            await request.drain<void>();
            request.response.statusCode = status;
            await request.response.close();
          });
          final sent = sample('syncRequest');
          final operation = (sent['operations'] as List).single as Map;
          final ref = sample('blobStart');
          final blob = {
            'encoding': 'blob',
            'ref': {
              'sha256': ref['sha256'],
              'byteLength': ref['byteLength'],
              'mediaType': ref['mediaType'],
            },
          };
          if (side == 'base') {
            operation['baseRevision'] = 1;
            operation['base'] = {'deleted': false, 'payload': blob};
          } else {
            (operation['next'] as Map)['payload'] = blob;
          }
          final frozen = jsonEncode(sent);
          await expectLater(
            WorkspaceV2Client().request(
              connection.copyWithAddress('127.0.0.1:${server.port}'),
              'sync',
              sent,
              reserveCounter: () async => 1,
            ),
            throwsA(
              isA<WorkspaceV2Failure>().having(
                (failure) => failure.uploadSessionExpired,
                'uploadSessionExpired',
                status == 410 && side == 'next',
              ),
            ),
          );
          expect(calls, 1);
          expect(jsonEncode(sent), frozen);
        },
      );
    }
  }

  test(
    'same-device requests serialize allocation through authenticated reply across client instances',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final live = connection.copyWithAddress('127.0.0.1:${server.port}');
      final allocated = Completer<void>(),
          releaseAllocation = Completer<void>();
      final arrived = Completer<void>(), releaseReply = Completer<void>();
      final arrivals = <int>[];
      var counters = 0;
      server.listen((request) async {
        final envelope = workspaceV2Map(
          jsonDecode(await utf8.decoder.bind(request).join()),
        );
        final counter = envelope['counter'] as int;
        arrivals.add(counter);
        final body = await WorkspaceV2WireCodec.open(
          live,
          envelope,
          requestEnvelope: envelope,
          direction: 'request',
        );
        expect(body['cursor'], sample('syncRequest')['cursor']);
        if (counter == 1) {
          arrived.complete();
          await releaseReply.future;
        }
        request.response.write(
          jsonEncode(
            await WorkspaceV2WireCodec.seal(
              live,
              'sync',
              sample('syncResponse'),
              requestId: envelope['requestId'] as String,
              counter: counter,
              direction: 'response',
            ),
          ),
        );
        await request.response.close();
      });
      final first = WorkspaceV2Client().request(
        live,
        'sync',
        sample('syncRequest'),
        reserveCounter: () async {
          final counter = ++counters;
          allocated.complete();
          await releaseAllocation.future;
          return counter;
        },
      );
      await allocated.future;
      final secondPayload = sample('syncRequest');
      final second = WorkspaceV2Client().request(
        live,
        'sync',
        secondPayload,
        reserveCounter: () async => ++counters,
      );
      secondPayload['cursor'] = 999999;
      await Future<void>.delayed(Duration.zero);
      expect(counters, 1);
      releaseAllocation.complete();
      await arrived.future;
      expect(counters, 1);
      expect(arrivals, [1]);
      releaseReply.complete();
      await Future.wait([first, second]);
      expect(counters, 2);
      expect(arrivals, [1, 2]);
    },
  );

  test(
    'cancelling a queued client consumes no counter and does not cancel another device lane owner',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final live = connection.copyWithAddress('127.0.0.1:${server.port}');
      final arrived = Completer<void>(), release = Completer<void>();
      var counters = 0, requests = 0;
      server.listen((request) async {
        requests++;
        final envelope = workspaceV2Map(
          jsonDecode(await utf8.decoder.bind(request).join()),
        );
        if (requests == 1) {
          arrived.complete();
          await release.future;
        }
        request.response.write(
          jsonEncode(
            await WorkspaceV2WireCodec.seal(
              live,
              'sync',
              sample('syncResponse'),
              requestId: envelope['requestId'] as String,
              counter: envelope['counter'] as int,
              direction: 'response',
            ),
          ),
        );
        await request.response.close();
      });
      final owner = WorkspaceV2Client();
      final queued = WorkspaceV2Client();
      Future<int> reserve() async => ++counters;
      final first = owner.request(
        live,
        'sync',
        sample('syncRequest'),
        reserveCounter: reserve,
      );
      await arrived.future;
      final second = queued.request(
        live,
        'sync',
        sample('syncRequest'),
        reserveCounter: reserve,
      );
      final rejected = expectLater(
        second,
        throwsA(
          isA<WorkspaceV2Failure>().having(
            (e) => e.cancelled,
            'cancelled',
            true,
          ),
        ),
      );
      queued.cancel();
      release.complete();
      await first;
      await rejected;
      expect(counters, 1);
      expect(requests, 1);
      await queued.request(
        live,
        'sync',
        sample('syncRequest'),
        reserveCounter: reserve,
      );
      expect(counters, 2);
      expect(requests, 2);
    },
  );

  test('oversize HTTP envelopes are rejected before parsing', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      await request.drain<void>();
      request.response.write('x' * 360001);
      await request.response.close();
    });
    await expectLater(
      WorkspaceV2Client().request(
        connection.copyWithAddress('127.0.0.1:${server.port}'),
        'sync',
        sample('syncRequest'),
        reserveCounter: () async => 1,
      ),
      throwsA(isA<WorkspaceV2Failure>()),
    );
  });
}
