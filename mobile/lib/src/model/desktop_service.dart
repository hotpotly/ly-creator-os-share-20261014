class DesktopService {
  const DesktopService({
    required this.serviceId,
    required this.name,
    required this.address,
    required this.protocolVersion,
  });

  final String serviceId;
  final String name;
  final String address;
  final int protocolVersion;

  @override
  bool operator ==(Object other) =>
      other is DesktopService &&
      other.serviceId == serviceId &&
      other.address == address &&
      other.protocolVersion == protocolVersion;

  @override
  int get hashCode => Object.hash(serviceId, address, protocolVersion);
}
