import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/model/desktop_connection.dart';
import 'package:ly_creator_capture/src/sync/workspace_sync_client.dart';

void main() {
  final fixture =
      jsonDecode(
            File(
              '../shared-fixtures/workspace-sync-v1.json',
            ).readAsStringSync(),
          )
          as Map;
  final identity = fixture['identity'] as Map;
  final crypto = fixture['crypto'] as Map;
  final payload = Map<String, dynamic>.from(
    jsonDecode(crypto['plaintext'] as String) as Map,
  );
  final connection = DesktopConnection(
    address: '127.0.0.1:1234',
    deviceId: identity['deviceId'] as String,
    serviceId: identity['serviceId'] as String,
    secretBase64: crypto['secretBase64'] as String,
    deviceName: 'fixture',
  );

  test(
    'HKDF and authenticated ciphertext match the shared Mac fixture',
    () async {
      expect(
        base64Encode(
          await (await WorkspaceWireCodec.key(connection)).extractBytes(),
        ),
        crypto['keyBase64'],
      );
      final envelope = await WorkspaceWireCodec.seal(
        connection,
        payload,
        requestId: identity['requestId'] as String,
        counter: identity['counter'] as int,
        nonce: base64Decode(crypto['nonce'] as String),
      );
      expect(envelope['ciphertext'], crypto['ciphertext']);
      expect(envelope['tag'], crypto['tag']);
      expect(
        utf8.decode(WorkspaceWireCodec.aad('request', envelope)),
        crypto['aad'],
      );
      expect(
        await WorkspaceWireCodec.open(
          connection,
          envelope,
          requestId: identity['requestId'] as String,
          counter: identity['counter'] as int,
          direction: 'request',
        ),
        payload,
      );
    },
  );

  test(
    'rejects reflection, changed identity, counter, body and extra headers',
    () async {
      final envelope = await WorkspaceWireCodec.seal(
        connection,
        payload,
        requestId: identity['requestId'] as String,
        counter: 7,
        direction: 'response',
      );
      Future<Map<String, dynamic>> open(Map<String, dynamic> value) =>
          WorkspaceWireCodec.open(
            connection,
            value,
            requestId: identity['requestId'] as String,
            counter: 7,
          );
      expect(await open(envelope), payload);
      for (final change in [
        {'counter': 8},
        {'requestId': '00000000-0000-4000-8000-000000000000'},
        {'serviceId': '00000000-0000-4000-8000-000000000000'},
        {'tag': base64Encode(List.filled(16, 0))},
        {'extra': true},
      ]) {
        await expectLater(
          open({...envelope, ...change}),
          throwsA(isA<Exception>()),
        );
      }
      final reflected = await WorkspaceWireCodec.seal(
        connection,
        payload,
        requestId: identity['requestId'] as String,
        counter: 7,
      );
      await expectLater(open(reflected), throwsA(isA<WorkspaceSyncFailure>()));
    },
  );

  test(
    'HTTP transport uses bounded encrypted request/response without plaintext',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final live = connection.copyWithAddress('127.0.0.1:${server.port}');
      server.listen((request) async {
        expect(request.uri.path, '/workspace/v1/sync');
        final body = await utf8.decoder.bind(request).join();
        expect(body, isNot(contains('拍摄开头')));
        final envelope = Map<String, dynamic>.from(jsonDecode(body) as Map);
        final plain = await WorkspaceWireCodec.open(
          live,
          envelope,
          requestId: envelope['requestId'] as String,
          counter: 9,
          direction: 'request',
        );
        final response = await WorkspaceWireCodec.seal(
          live,
          plain,
          requestId: envelope['requestId'] as String,
          counter: 9,
          direction: 'response',
        );
        request.response.write(jsonEncode(response));
        await request.response.close();
      });
      expect(await WorkspaceSyncClient().sync(live, payload, 9), payload);
    },
  );

  test('cancel during encryption never opens a network request', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    int hits = 0;
    server.listen((request) async {
      hits++;
      await request.response.close();
    });
    final client = WorkspaceSyncClient();
    final pending = client.sync(
      connection.copyWithAddress('127.0.0.1:${server.port}'),
      payload,
      8,
    );
    client.cancel();
    await expectLater(pending, throwsA(isA<WorkspaceSyncFailure>()));
    expect(hits, 0);
  });

  test('revoked devices fail without exposing untrusted server text', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      await request.drain<void>();
      request.response.statusCode = 401;
      request.response.write('untrusted detail');
      await request.response.close();
    });
    await expectLater(
      WorkspaceSyncClient().sync(
        connection.copyWithAddress('127.0.0.1:${server.port}'),
        payload,
        8,
      ),
      throwsA(
        isA<WorkspaceSyncFailure>().having(
          (e) => e.requiresPairing,
          'requiresPairing',
          true,
        ),
      ),
    );
  });
}
