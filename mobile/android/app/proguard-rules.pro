# Room creates generated database implementations through reflection.
# Keep their no-argument constructors in minified release builds.
-keep class * extends androidx.room.RoomDatabase {
    <init>();
}
