import '../model/desktop_connection.dart';

abstract interface class ConnectionStore {
  Future<DesktopConnection?> load();
  Future<void> save(DesktopConnection connection);
  Future<void> clear();
}

class MemoryConnectionStore implements ConnectionStore {
  MemoryConnectionStore([this.connection]);
  DesktopConnection? connection;

  @override
  Future<void> clear() async => connection = null;

  @override
  Future<DesktopConnection?> load() async => connection;

  @override
  Future<void> save(DesktopConnection connection) async =>
      this.connection = connection;
}
