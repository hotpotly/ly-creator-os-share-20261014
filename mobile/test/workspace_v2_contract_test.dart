import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:ly_creator_capture/src/workspace/workspace_v2_contract.dart';

void main() {
  final fixture = workspaceV2Map(
    jsonDecode(
      File('../shared-fixtures/workspace-sync-v2.json').readAsStringSync(),
    ),
  );
  for (final item in fixture['cases'] as List) {
    final value = workspaceV2Map(item);
    test('shared schema ${value['name']}', () {
      Map<String, dynamic> validate() =>
          workspaceV2Validate(value['schema'] as String, value['value']);
      if (value['valid'] == true) {
        expect(validate, returnsNormally);
      } else {
        expect(validate, throwsA(isA<Exception>()));
      }
    });
  }
  for (final value in fixture['canonicalCases'] as List) {
    test('shared ${value['name']}', () {
      final canonical = workspaceV2CanonicalJson(
        jsonDecode(value['inputJson'] as String),
      );
      expect(canonical, value['canonical']);
      expect(workspaceV2Sha256Sync(utf8.encode(canonical)), value['sha256']);
    });
  }
  for (final value in fixture['rawHashCases'] as List) {
    test('shared original byte hash ${value['sha256']}', () {
      final bytes = utf8.encode(value['json'] as String);
      expect(bytes.length, value['byteLength']);
      expect(workspaceV2Sha256Sync(bytes), value['sha256']);
      expect(
        workspaceV2Sha256Sync(
          utf8.encode(
            workspaceV2CanonicalJson(jsonDecode(value['json'] as String)),
          ),
        ),
        value['canonicalSha256'],
      );
    });
  }
  for (final value in fixture['aadCases'] as List) {
    test('shared AAD ${value['name']}', () {
      expect(
        workspaceV2Aad(
          value['direction'] as String,
          workspaceV2Map(jsonDecode(value['identityJson'] as String)),
        ),
        value['expected'],
      );
    });
  }
  for (final value in fixture['manifestCases'] as List) {
    test('shared manifest ${value['name']}', () {
      final manifest = workspaceV2Map(value['manifest']);
      final records = (value['records'] as List).map(workspaceV2Map).toList();
      final text = workspaceV2ManifestText(records);
      expect(text, value['entriesUtf8']);
      expect(base64Encode(utf8.encode(text)), value['entriesBase64']);
      expect(workspaceV2ManifestDigest(records), value['sha256']);
      expect(
        () => workspaceV2VerifyManifest(manifest, records),
        returnsNormally,
      );
      expect(
        () => workspaceV2VerifyManifest({
          ...manifest,
          'entityCount': records.length + 1,
        }, records),
        throwsFormatException,
      );
      if (records.length > 1) {
        expect(
          () => workspaceV2ManifestText(records.reversed.toList()),
          throwsFormatException,
        );
      }
    });
  }
  for (final value in fixture['chunkCases'] as List) {
    test('shared chunk ${value['byteLength']}:${value['index']}', () {
      int calculate() => workspaceV2ExpectedChunkLength(
        value['byteLength'] as int,
        value['index'] as int,
      );
      if (value['expectedLength'] == null) {
        expect(calculate, throwsFormatException);
      } else {
        expect(calculate(), value['expectedLength']);
      }
    });
  }
  for (final value in fixture['budgetCases'] as List) {
    test('shared budget ${value['name']}', () {
      final input = workspaceV2Map(value)
        ..remove('name')
        ..remove('allowed');
      expect(workspaceV2CheckUploadBudget(input), value['allowed']);
    });
  }
  for (final value in fixture['sessionCases'] as List) {
    test(
      'shared session ${value['createdAtMs']}:${value['lastActivityMs']}',
      () {
        expect(
          workspaceV2SessionExpiry(
            value['createdAtMs'] as num,
            value['lastActivityMs'] as num,
          ),
          value['expiresAtMs'],
        );
      },
    );
  }
  for (final value in fixture['identityCases'] as List) {
    test('shared identity ${value['name']}', () {
      void validate() => workspaceV2AssertEnvelopeBody(
        workspaceV2Map(value['envelope']),
        workspaceV2Map(value['body']),
      );
      expect(
        validate,
        value['valid'] == true ? returnsNormally : throwsFormatException,
      );
    });
  }
  for (final value in fixture['contextCases'] as List) {
    test('shared context ${value['name']}', () {
      void validate() {
        switch (value['helper']) {
          case 'responseEnvelope':
            workspaceV2AssertResponseEnvelope(
              value['request'],
              value['response'],
            );
            break;
          case 'capabilities':
            workspaceV2AssertCapabilities(
              value['request'],
              value['response'],
              (value['approvedPermissions'] as List)
                  .map(workspaceV2Map)
                  .toList(),
            );
            break;
          case 'syncResponse':
            workspaceV2AssertSyncResponse(value['request'], value['response']);
            break;
          default:
            fail('Unknown context helper ${value['helper']}');
        }
      }

      expect(
        validate,
        value['valid'] == true ? returnsNormally : throwsFormatException,
      );
    });
  }
  test('shared limits and scope digests', () {
    expect(workspaceV2Limits, fixture['limits']);
    for (final value in fixture['scopeDigests'] as List) {
      expect(
        workspaceV2ScopeDigest((value['scopes'] as List).cast<String>()),
        value['scopeDigest'],
      );
    }
  });
  test('shared multi-chunk JSON retains source bytes and final short block', () {
    final document = workspaceV2Map(fixture['blobDocument']);
    final recipe = workspaceV2Map(document['recipe']);
    final bytes = utf8.encode(
      '${recipe['prefix']}${(recipe['repeat'] as String) * (recipe['repeatCount'] as int)}${recipe['suffix']}',
    );
    expect(bytes.length, document['byteLength']);
    expect(workspaceV2Sha256Sync(bytes), document['sha256']);
    expect(
      base64Encode(bytes.sublist(2 * workspaceV2ChunkBytes)),
      document['tailBase64'],
    );
  });
  test(
    'shared HKDF and request/response AES-GCM fixtures bind purpose and direction',
    () async {
      final crypto = workspaceV2Map(fixture['crypto']);
      final identity = workspaceV2Map(fixture['identity']);
      final key = await Hkdf(hmac: Hmac.sha256(), outputLength: 32).deriveKey(
        secretKey: SecretKey(
          base64Decode(crypto['fakeSecretBase64'] as String),
        ),
        nonce: utf8.encode(identity['serviceId'] as String),
        info: utf8.encode(workspaceV2KeyInfo),
      );
      expect(base64Encode(await key.extractBytes()), crypto['keyBase64']);
      for (final direction in ['request', 'response']) {
        final vector = workspaceV2Map(crypto[direction]);
        final envelope = workspaceV2Validate('envelope', vector['envelope']);
        final aad = workspaceV2Aad(direction, envelope);
        expect(aad, vector['aad']);
        expect(
          workspaceV2Validate('envelope', {...envelope, 'counter': 7.0}),
          isA<Map>(),
        );
        expect(
          () => workspaceV2Validate('envelope', {...envelope, 'counter': -0.0}),
          throwsFormatException,
        );
        expect(workspaceV2Aad(direction, {...envelope, 'counter': 7.0}), aad);
        final box = await AesGcm.with256bits().encrypt(
          utf8.encode(vector['plaintext'] as String),
          secretKey: key,
          nonce: base64Decode(envelope['nonce'] as String),
          aad: utf8.encode(aad),
        );
        expect(base64Encode(box.cipherText), envelope['ciphertext']);
        expect(base64Encode(box.mac.bytes), envelope['tag']);
        expect(
          utf8.decode(
            await AesGcm.with256bits().decrypt(
              box,
              secretKey: key,
              aad: utf8.encode(aad),
            ),
          ),
          vector['plaintext'],
        );
        await expectLater(
          AesGcm.with256bits().decrypt(
            box,
            secretKey: key,
            aad: utf8.encode(
              workspaceV2Aad(direction, {...envelope, 'purpose': 'blob.read'}),
            ),
          ),
          throwsA(isA<SecretBoxAuthenticationError>()),
        );
      }
    },
  );

  test(
    'canonical JSON uses UTF16 key order and ECMAScript string escaping',
    () {
      expect(
        workspaceV2CanonicalJson({
          '\uE000': 1,
          '😀': -0.0,
          'a': [1.0, true, null, '\ud800', '\udc00'],
        }),
        '{"a":[1,true,null,"\\ud800","\\udc00"],"😀":0,"\uE000":1}',
      );
      expect(
        workspaceV2CanonicalJson('"\\\b\t\n\f\r\u0000'),
        '"\\"\\\\\\b\\t\\n\\f\\r\\u0000"',
      );
      expect(() => workspaceV2CanonicalJson(1.5), throwsFormatException);
      expect(() => workspaceV2CanonicalJson(double.nan), throwsFormatException);
      expect(
        () => workspaceV2CanonicalJson(9007199254740992),
        throwsFormatException,
      );
      final cycle = <Object>[];
      cycle.add(cycle);
      expect(() => workspaceV2CanonicalJson(cycle), throwsFormatException);
    },
  );

  test(
    'safe integer, UUID and local day validators match frozen scalar boundaries',
    () {
      expect(workspaceV2SafeInteger(1.0), true);
      expect(workspaceV2SafeInteger(9007199254740991), true);
      for (final value in [
        9007199254740992,
        -1,
        1.1,
        '1',
        true,
        double.infinity,
      ]) {
        expect(workspaceV2SafeInteger(value), false);
      }
      for (final value in [
        'ABCDEFAB-CDEF-4DEF-8DEF-ABCDEFABCDEF',
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ]) {
        expect(workspaceV2Uuid(value), true);
      }
      for (final value in [
        'abcdefab-cdef-4def-7def-abcdefabcdef',
        'abcdefab-cdef-0def-8def-abcdefabcdef',
        'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
      ]) {
        expect(workspaceV2Uuid(value), false);
      }
      for (final value in [
        '2024-02-29',
        '1900-01-01',
        '2199-12-31',
        '2200-01-01',
        '0000-02-29',
        '9999-12-31',
      ]) {
        expect(workspaceV2Day(value), true);
      }
      for (final value in [
        '2026-02-29',
        '2026-02-30',
        '2026-1-01',
        '10000-01-01',
      ]) {
        expect(workspaceV2Day(value), false);
      }
    },
  );

  test(
    'hashes retain original UTF8 bytes rather than semantic JSON equivalence',
    () async {
      final first = utf8.encode('{"a":1,"正文":"照片😀"}');
      final second = utf8.encode('{ "正文":"照片😀", "a": 1 }');
      expect(jsonDecode(utf8.decode(first)), jsonDecode(utf8.decode(second)));
      expect(
        await workspaceV2Sha256(first),
        isNot(await workspaceV2Sha256(second)),
      );
      expect(workspaceV2Sha256Sync(first), await workspaceV2Sha256(first));
      expect(
        workspaceV2Sha256Sync(const []),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    },
  );

  test(
    'chunk lengths, canonical base64 and hashes reject truncation and invalid offsets',
    () async {
      expect(workspaceV2ExpectedChunkLength(65536, 0), 65536);
      expect(workspaceV2ExpectedChunkLength(65536.0, 0.0), 65536);
      expect(workspaceV2ExpectedChunkLength(65537, 0), 65536);
      expect(workspaceV2ExpectedChunkLength(65537, 1), 1);
      expect(
        () => workspaceV2ExpectedChunkLength(65536, 1),
        throwsFormatException,
      );
      expect(
        () => workspaceV2ExpectedChunkLength(1, -1),
        throwsFormatException,
      );
      final bytes = [42];
      expect(
        await workspaceV2VerifyChunk(
          bytesBase64: base64Encode(bytes),
          sha256: await workspaceV2Sha256(bytes),
          byteLength: 65537,
          index: 1,
        ),
        bytes,
      );
      await expectLater(
        workspaceV2VerifyChunk(
          bytesBase64: base64Encode(bytes),
          sha256: '0' * 64,
          byteLength: 65537,
          index: 1,
        ),
        throwsFormatException,
      );
      for (final value in ['', 'Kg', 'Kh==', 'Kg==\n', '_g==']) {
        expect(() => workspaceV2DecodeBase64(value), throwsFormatException);
      }
    },
  );

  test(
    'resource caps charge declared bytes and independent idle or absolute TTL',
    () {
      expect(
        workspaceV2UploadFits(
          activeUploads: 1,
          deviceDeclaredBytes: workspaceV2DeviceTemporaryBytes - 10,
          workspaceDeclaredBytes: workspaceV2WorkspaceTemporaryBytes - 10,
          incomingBytes: 10,
        ),
        true,
      );
      expect(
        workspaceV2UploadFits(
          activeUploads: 2,
          deviceDeclaredBytes: 0,
          workspaceDeclaredBytes: 0,
          incomingBytes: 10,
        ),
        false,
      );
      expect(
        workspaceV2UploadFits(
          activeUploads: 0,
          deviceDeclaredBytes: workspaceV2DeviceTemporaryBytes,
          workspaceDeclaredBytes: 0,
          incomingBytes: 1,
        ),
        false,
      );
      final now = DateTime.utc(2026, 10, 3);
      expect(
        workspaceV2TemporaryExpired(
          createdAt: now.subtract(const Duration(days: 7)),
          lastActivityAt: now,
          now: now,
        ),
        true,
      );
      expect(
        workspaceV2TemporaryExpired(
          createdAt: now.subtract(const Duration(days: 2)),
          lastActivityAt: now.subtract(const Duration(hours: 24)),
          now: now,
        ),
        true,
      );
      expect(
        workspaceV2TemporaryExpired(
          createdAt: now.subtract(const Duration(days: 6)),
          lastActivityAt: now.subtract(const Duration(hours: 23)),
          now: now,
        ),
        false,
      );
    },
  );
}
