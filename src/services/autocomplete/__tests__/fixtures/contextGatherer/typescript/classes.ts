// @ts-nocheck

class _Group extends BaseClass {}

class _Group2 implements FirstInterface {} // Renamed to avoid duplicate identifier

class _Group3 extends BaseClass implements FirstInterface, SecondInterface {} // Renamed

class _Group4 extends BaseClass<User> implements FirstInterface<User> {} // Renamed
