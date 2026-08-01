import enum


class PackagingType(str, enum.Enum):
    BOTTLE = "bottle"
    BOX = "box"
    SACHET = "sachet"
    JERRYCAN = "jerrycan"


class Material(str, enum.Enum):
    PET = "PET"
    PP = "PP"
    HDPE = "HDPE"
    LDPE = "LDPE"
    PE = "PE"
