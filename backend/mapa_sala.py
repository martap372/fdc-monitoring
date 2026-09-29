import json
import logging
import os
import threading
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from uuid import uuid4

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
EVENTS_FILE = os.path.join(DATA_DIR, 'events.json')
WEEKLY_HOURS_FILE = os.path.join(DATA_DIR, 'weekly_hours.json')
WEEKDAYS = (
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday',
)
_VENCIMENTO_UPDATE_LOCK = threading.Lock()
_pending_vencimento_updates = {}
_vencimento_worker_running = False
_vencimento_update_revision = 0


def _process_vencimento_updates():
	global _pending_vencimento_updates, _vencimento_worker_running

	while True:
		with _VENCIMENTO_UPDATE_LOCK:
			updates = _pending_vencimento_updates
			_pending_vencimento_updates = {}
			if not updates:
				_vencimento_worker_running = False
				return

		for year, events in updates.items():
			try:
				from vencimento import generate_vencimento
				if events is None:
					generate_vencimento(year=year)
				else:
					generate_vencimento(year=year, events=events)
			except Exception:
				logging.exception('Failed to regenerate the Vencimento workbook')


def schedule_vencimento_update(year=None, events=None):
	global _pending_vencimento_updates, _vencimento_worker_running
	global _vencimento_update_revision

	with _VENCIMENTO_UPDATE_LOCK:
		_pending_vencimento_updates[year] = (
			[dict(event) for event in events] if events is not None else None
		)
		_vencimento_update_revision += 1
		if _vencimento_worker_running:
			return
		_vencimento_worker_running = True

	threading.Thread(target=_process_vencimento_updates, daemon=True).start()


def vencimento_update_status():
	with _VENCIMENTO_UPDATE_LOCK:
		return {
			'updating': _vencimento_worker_running,
			'revision': _vencimento_update_revision,
		}


def day_of_week(start):
	if not start:
		return None

	try:
		date = datetime.fromisoformat(start.replace('Z', '+00:00'))
		return WEEKDAYS[date.weekday()]
	except (AttributeError, ValueError):
		return None


def add_day_of_week(event):
	weekday = day_of_week(event.get('start'))
	if weekday:
		event['dayOfWeek'] = weekday
	return event


def parse_event_date(value):
	if not value:
		return None

	try:
		date = datetime.fromisoformat(value.replace('Z', '+00:00'))
		return date if date.tzinfo else date.replace(tzinfo=timezone.utc)
	except (AttributeError, TypeError, ValueError):
		return None


def week_number_in_month(date):
	month_start = date.replace(day=1)
	month_start_day = month_start.weekday()
	first_week_start = month_start - timedelta(days=month_start_day)
	return ((date.date() - first_week_start.date()).days // 7) + 1


def easter_sunday(year):
	century = year // 100
	year_in_century = year % 100
	leap_years = century // 4
	century_remainder = century % 4
	moon_correction = (century + 8) // 25
	calendar_correction = (century - moon_correction + 1) // 3
	golden_number = year % 19
	moon_phase = (
		19 * golden_number + century - leap_years - calendar_correction + 15
	) % 30
	leap_year_in_century = year_in_century // 4
	year_remainder = year_in_century % 4
	weekday_correction = (
		32 + 2 * century_remainder + 2 * leap_year_in_century - moon_phase - year_remainder
	) % 7
	date_correction = (
		golden_number + 11 * moon_phase + 22 * weekday_correction
	) // 451
	month = (
		moon_phase + weekday_correction - 7 * date_correction + 114
	) // 31
	day = (
		(moon_phase + weekday_correction - 7 * date_correction + 114) % 31
	) + 1
	return date(year, month, day)


@lru_cache(maxsize=None)
def portuguese_holidays(year):
	easter = easter_sunday(year)
	return frozenset((
		date(year, 1, 1),
		easter - timedelta(days=2),
		easter,
		date(year, 4, 25),
		date(year, 5, 1),
		easter + timedelta(days=60),
		date(year, 6, 10),
		date(year, 8, 15),
		date(year, 10, 5),
		date(year, 11, 1),
		date(year, 12, 1),
		date(year, 12, 8),
		date(year, 12, 25),
	))


def hours_category_for_date(day):
	if day.weekday() == 6 or day in portuguese_holidays(day.year):
		return 'sunday_hours'
	if day.weekday() == 5:
		return 'saturday_hours'
	return 'weekday_hours'


def build_weekly_hours(events):
	import app

	weekly_hours = {}

	for event in events:
		start = parse_event_date(event.get('start'))
		end = parse_event_date(event.get('end'))
		person = event.get('title')
		if not start or not end or not person or end <= start:
			continue

		cursor = start
		while cursor < end:
			next_day = (cursor + timedelta(days=1)).replace(
				hour=0, minute=0, second=0, microsecond=0
			)
			segment_end = min(next_day, end)
			week_number = week_number_in_month(cursor)
			week_key = f'{cursor.year}-{cursor.month:02d}-week-{week_number}'
			week = weekly_hours.setdefault(week_key, {
				'week_start': cursor.date().isoformat(),
				'month': cursor.month,
				'week_number': week_number,
				'weekday_hours': {name: 0 for name in app.PEOPLE},
				'saturday_hours': {name: 0 for name in app.PEOPLE},
				'sunday_hours': {name: 0 for name in app.PEOPLE},
			})
			hours = week[hours_category_for_date(cursor.date())]
			hours[person] = hours.get(person, 0) + (
				(segment_end - cursor).total_seconds() / 3600
			)
			cursor = segment_end

	for week in weekly_hours.values():
		for category in ('weekday_hours', 'saturday_hours', 'sunday_hours'):
			for person, hours in week[category].items():
				week[category][person] = round(hours, 2)

	return weekly_hours


def build_monthly_hours(events, year, month):
	import app

	monthly_hours = {
		person: {
			'person': person,
			'weekday_hours': 0,
			'saturday_hours': 0,
			'sunday_hours': 0,
			'weekday_saturday_value': 0,
			'sunday_value': 0,
			'total_value': 0,
		}
		for person in app.PEOPLE
	}

	for event in events:
		start = parse_event_date(event.get('start'))
		end = parse_event_date(event.get('end'))
		person = event.get('title')
		if not start or not end or person not in monthly_hours or end <= start:
			continue

		cursor = start
		while cursor < end:
			next_day = (cursor + timedelta(days=1)).replace(
				hour=0, minute=0, second=0, microsecond=0
			)
			segment_end = min(next_day, end)
			if cursor.year == year and cursor.month == month:
				hours = (segment_end - cursor).total_seconds() / 3600
				category = hours_category_for_date(cursor.date())
				monthly_hours[person][category] += hours
			cursor = segment_end

	for totals in monthly_hours.values():
		totals['weekday_hours'] = round(totals['weekday_hours'], 2)
		totals['saturday_hours'] = round(totals['saturday_hours'], 2)
		totals['sunday_hours'] = round(totals['sunday_hours'], 2)
		totals['weekday_saturday_value'] = round(
			(totals['weekday_hours'] + totals['saturday_hours']) * 7, 2
		)
		totals['sunday_value'] = round(totals['sunday_hours'] * 8.5, 2)
		totals['total_value'] = round(
			totals['weekday_saturday_value'] + totals['sunday_value'], 2
		)

	return list(monthly_hours.values())


def write_weekly_hours(events):
	with open(WEEKLY_HOURS_FILE, 'w', encoding='utf-8') as hours_file:
		json.dump(build_weekly_hours(events), hours_file, ensure_ascii=False, indent=2)


def read_events():
	if not os.path.exists(EVENTS_FILE):
		return []

	with open(EVENTS_FILE, 'r', encoding='utf-8') as events_file:
		events = json.load(events_file)

	updated_events = [add_day_of_week(event) for event in events]
	if updated_events != events:
		write_events(updated_events)
	else:
		write_weekly_hours(events)
	return updated_events


def write_events(events):
	temporary_file = f'{EVENTS_FILE}.tmp'
	with open(temporary_file, 'w', encoding='utf-8') as events_file:
		json.dump(events, events_file, ensure_ascii=False, indent=2)
	os.replace(temporary_file, EVENTS_FILE)
	write_weekly_hours(events)
	schedule_vencimento_update(events=events)


