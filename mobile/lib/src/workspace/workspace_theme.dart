import 'package:flutter/material.dart';

Color workspaceWorkMinutesColor(num? minutes, Brightness brightness) {
  final dark = brightness == Brightness.dark;
  if (minutes == null) return Color(dark ? 0xffa0a0a0 : 0xff7a7068);
  if (minutes == 0) return Color(dark ? 0xffe07a73 : 0xffb84b43);
  if (minutes >= 360) return Color(dark ? 0xff82c68b : 0xff4f7a55);
  return Color(dark ? 0xffd7a657 : 0xff9a621e);
}

({Color background, Color foreground})? workspaceIdentityColors(
  String? token,
  Brightness brightness,
) {
  final index = int.tryParse(token?.replaceFirst('project-', '') ?? '');
  if (token != 'project-$index' || index == null || index < 1 || index > 12) {
    return null;
  }
  const light = [
    (0xffe1f4d6, 0xff426b28),
    (0xffd6eafc, 0xff2c5679),
    (0xffefe0f6, 0xff5f3d6e),
    (0xfff9e4d3, 0xff76491f),
    (0xfff3edc9, 0xff655a20),
    (0xffd5f0e8, 0xff2d6653),
    (0xfff8dee6, 0xff7a3e52),
    (0xffe0e3fa, 0xff404a82),
    (0xffd8f0f2, 0xff235c62),
    (0xfff6ded9, 0xff73372f),
    (0xffe5eed6, 0xff465e28),
    (0xffe3e9ee, 0xff40505e),
  ];
  const dark = [
    (0xff253d1f, 0xffb8e99b),
    (0xff203748, 0xffa6d5fc),
    (0xff3c2c43, 0xffdcb0ec),
    (0xff493122, 0xfff4be89),
    (0xff3e3920, 0xffe6d781),
    (0xff203d35, 0xffa6e3cd),
    (0xff472a34, 0xfff2b3c6),
    (0xff2c3150, 0xffbfc6fa),
    (0xff1e3a3d, 0xff9ddfe4),
    (0xff442a27, 0xfff0aea5),
    (0xff313a24, 0xffc3dd95),
    (0xff2d353d, 0xffc3d0db),
  ];
  final pair = (brightness == Brightness.dark ? dark : light)[index - 1];
  return (background: Color(pair.$1), foreground: Color(pair.$2));
}

ThemeData workspaceTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xff6b7c5a),
    brightness: brightness,
    primary: Color(dark ? 0xff9aac8a : 0xff6b7c5a),
    onPrimary: Color(dark ? 0xff172014 : 0xffffffff),
    surface: Color(dark ? 0xff1d1d1d : 0xffffffff),
    onSurface: Color(dark ? 0xfff2f2f2 : 0xff2c2c2c),
    onSurfaceVariant: Color(dark ? 0xffa0a0a0 : 0xff7a7068),
    outlineVariant: Color(dark ? 0xff353535 : 0xffd5cdbd),
    primaryContainer: Color(dark ? 0xff30352d : 0xffeceedc),
    onPrimaryContainer: Color(dark ? 0xfff2f2f2 : 0xff2c2c2c),
    surfaceContainerLow: Color(dark ? 0xff252525 : 0xfff2eee6),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: Color(dark ? 0xff151515 : 0xfffaf8f3),
    fontFamilyFallback: const ['Noto Sans CJK SC', 'sans-serif'],
    appBarTheme: AppBarTheme(
      backgroundColor: Color(dark ? 0xff151515 : 0xfffaf8f3),
      scrolledUnderElevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surfaceContainerLow,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.primary.withValues(alpha: .5)),
      ),
      contentPadding: const EdgeInsets.all(14),
    ),
    expansionTileTheme: const ExpansionTileThemeData(
      shape: Border(),
      collapsedShape: Border(),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    chipTheme: ChipThemeData(
      side: BorderSide.none,
      backgroundColor: scheme.surfaceContainerLow,
      selectedColor: scheme.primaryContainer,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      backgroundColor: scheme.surface,
      indicatorColor: scheme.primary.withValues(alpha: .13),
    ),
  );
}
