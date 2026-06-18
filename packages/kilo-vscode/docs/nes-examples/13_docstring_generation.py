import datetime


def parse_iso_datetime(s):
    """Parse an ISO 8601 datetime string into a datetime.datetime."""
    return datetime.datetime.fromisoformat(s)


def parse_iso_date(s):

    return datetime.date.fromisoformat(s)
