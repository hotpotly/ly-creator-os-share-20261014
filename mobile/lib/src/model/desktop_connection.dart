class DesktopConnection {
  const DesktopConnection({
    required this.address,
    required this.deviceId,
    required this.secretBase64,
    required this.deviceName,
    this.protocolVersion = 2,
    this.serviceId,
  });

  final String address;
  final String deviceId;
  final String secretBase64;
  final String deviceName;
  final int protocolVersion;
  final String? serviceId;

  bool get needsSecurityUpgrade => protocolVersion < 2;

  DesktopConnection copyWithAddress(String value) => DesktopConnection(
    address: value,
    deviceId: deviceId,
    secretBase64: secretBase64,
    deviceName: deviceName,
    protocolVersion: protocolVersion,
    serviceId: serviceId,
  );

  Map<String, Object?> toJson() => {
    'address': address,
    'deviceId': deviceId,
    'secretBase64': secretBase64,
    'deviceName': deviceName,
    'protocolVersion': protocolVersion,
    'serviceId': serviceId,
  };

  static DesktopConnection fromJson(Map<String, Object?> json) {
    return DesktopConnection(
      address: json['address']! as String,
      deviceId: json['deviceId']! as String,
      secretBase64: json['secretBase64']! as String,
      deviceName: json['deviceName']! as String,
      protocolVersion: json['protocolVersion'] is int
          ? json['protocolVersion']! as int
          : 1,
      serviceId: json['serviceId'] as String?,
    );
  }
}
