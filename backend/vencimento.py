import json
import os
import re
import threading
from datetime import datetime

import pandas as pd
from openpyxl import load_workbook

from mapa_sala import build_monthly_hours
from pt import BACKEND_DIR, WORKBOOK_LOCK


MONTHS = [
	"Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
	"Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]
OUTPUT_PREFIX = "Vencimento_"
AF_CLOSURES_PATH = os.path.join(BACKEND_DIR, "af_closures.json")


def get_af_closure_override(year, month, person):
	try:
		with open(AF_CLOSURES_PATH, encoding="utf-8") as overrides_file:
			overrides = json.load(overrides_file)
	except (FileNotFoundError, json.JSONDecodeError):
		return None
	return overrides.get(str(year), {}).get(person, {}).get(str(month))


def set_af_closure_override(year, month, person, value):
	try:
		with open(AF_CLOSURES_PATH, encoding="utf-8") as overrides_file:
			overrides = json.load(overrides_file)
	except (FileNotFoundError, json.JSONDecodeError):
		overrides = {}
	overrides.setdefault(str(year), {}).setdefault(person, {})[str(month)] = value
	temporary_path = f"{AF_CLOSURES_PATH}.tmp"
	with open(temporary_path, "w", encoding="utf-8") as overrides_file:
		json.dump(overrides, overrides_file, ensure_ascii=False, indent=2)
	os.replace(temporary_path, AF_CLOSURES_PATH)


def _pt_files():
	return sorted(
		filename for filename in os.listdir(BACKEND_DIR)
		if filename.startswith("PT_") and filename.endswith(".xlsx")
	)


def _pt_file_by_month(year):
	files = {}
	for filename in _pt_files():
		match = re.fullmatch(r"PT_(.+)(\d{4})\.xlsx", filename)
		if match and int(match.group(2)) == year and match.group(1) in MONTHS:
			files[MONTHS.index(match.group(1)) + 1] = filename
	return files


def _af_file_by_month(year):
	files = {}
	for filename in os.listdir(BACKEND_DIR):
		match = re.fullmatch(r"AF_(.+)(\d{4})\.xlsx", filename)
		if match and int(match.group(2)) == year and match.group(1) in MONTHS:
			files[MONTHS.index(match.group(1)) + 1] = filename
	return files


def _af_status_totals(af_files, year):
	"""Count paid AF evaluations and closes by AF workbook month and PT."""
	import app

	total_af = {}
	fechos_af = {}
	for month, filename in af_files.items():
		workbook = load_workbook(
			os.path.join(BACKEND_DIR, filename), data_only=True, read_only=True
		)
		for person in app.PEOPLE:
			if person not in workbook.sheetnames:
				continue
			worksheet = workbook[person]
			headers = [cell.value for cell in worksheet[1]]
			try:
				client_pt_column = headers.index("Cliente PT")
				fecho_column = headers.index("Fecho")
			except ValueError:
				continue
			paid_count = 0
			fecho_count = 0
			for row in worksheet.iter_rows(min_row=2, values_only=True):
				if len(row) > max(client_pt_column, fecho_column):
					paid_count += (
						row[client_pt_column] == "Não"
						or row[fecho_column] == "Sim"
					)
					fecho_count += row[fecho_column] == "Sim"
			total_af[(person, month)] = paid_count
			fechos_af[(person, month)] = get_af_closure_override(year, month, person)
			if fechos_af[(person, month)] is None:
				fechos_af[(person, month)] = fecho_count
		workbook.close()
	return total_af, fechos_af


def _existing_external_values(year):
	import app

	filename = os.path.join(BACKEND_DIR, f"{OUTPUT_PREFIX}{year}.xlsx")
	if not os.path.exists(filename):
		return {}

	workbook = load_workbook(filename, data_only=False, read_only=True)
	values = {}
	for person in app.PEOPLE:
		if person not in workbook.sheetnames:
			continue
		worksheet = workbook[person]
		is_run_club_layout = person == "Pedro Freitas" and worksheet.cell(row=1, column=13).value == "RUN CLUB"
		is_simao_layout = (
			person == "Simão Sá"
			and str(worksheet.cell(row=1, column=14).value).strip().casefold() == "comissão simão"
		)
		external_column = 16 if is_run_club_layout else 15 if is_simao_layout else 14
		values[person] = {
			worksheet.cell(row=row, column=1).value: worksheet.cell(row=row, column=external_column).value or 0
			for row in range(3, 15)
			if worksheet.cell(row=row, column=1).value
		}
	workbook.close()
	return values


def _existing_run_club_values(year):
	import app

	filename = os.path.join(BACKEND_DIR, f"{OUTPUT_PREFIX}{year}.xlsx")
	if not os.path.exists(filename):
		return {}

	workbook = load_workbook(filename, data_only=False, read_only=True)
	values = {}
	for person in app.PEOPLE:
		if person != "Pedro Freitas" or person not in workbook.sheetnames:
			continue
		worksheet = workbook[person]
		if worksheet.cell(row=1, column=13).value != "RUN CLUB":
			continue
		values[person] = {
			worksheet.cell(row=row, column=1).value: worksheet.cell(row=row, column=13).value or 0
			for row in range(3, 15)
			if worksheet.cell(row=row, column=1).value
		}
	workbook.close()
	return values


def _calendar_totals(events, year, month, person):
	totals = build_monthly_hours(events, year, month)
	person_totals = next(item for item in totals if item["person"] == person)
	return (
		person_totals["weekday_hours"] + person_totals["saturday_hours"],
		person_totals["sunday_hours"],
	)


def _source_values(filename, sheet):
	if not filename:
		return 0, 0, 0

	workbook = load_workbook(
		os.path.join(BACKEND_DIR, filename), data_only=False, read_only=True
	)
	if sheet not in workbook.sheetnames:
		workbook.close()
		return 0, 0, 0
	worksheet = workbook[sheet]
	hours = 0
	value_with_vat = 0
	commission = 0
	for row in range(2, worksheet.max_row + 1):
		row_hours = worksheet.cell(row, 4).value
		row_value = worksheet.cell(row, 5).value
		if isinstance(row_hours, (int, float)):
			hours += row_hours
		if isinstance(row_value, (int, float)):
			value_with_vat += row_value

		trainings_done = worksheet.cell(row, 9).value
		total_trainings = worksheet.cell(row, 8).value
		if isinstance(trainings_done, str) and trainings_done.isnumeric():
			trainings_done = float(trainings_done)
		if isinstance(total_trainings, str) and total_trainings.isnumeric():
			total_trainings = float(total_trainings)
		pt_rate = worksheet.cell(row, 6).value
		if isinstance(pt_rate, str):
			try:
				pt_rate = float(pt_rate)
			except ValueError:
				pt_rate = 0
		if isinstance(row_value, (int, float)) and isinstance(trainings_done, (int, float)) and isinstance(total_trainings, (int, float)) and total_trainings:
			pt_commission = round(row_value * pt_rate / 1.23, 2)
			commission += trainings_done * round(pt_commission / total_trainings, 2)

	for row in range(2, worksheet.max_row + 1):
		if worksheet.cell(row, 15).value == "Total Faturação":
			summary_value = worksheet.cell(row, 16).value
			if isinstance(summary_value, (int, float)):
				value_with_vat = summary_value
			break
	return round(hours, 2), round(value_with_vat, 2), round(commission, 2)


def _write_sheet(
	workbook, person, year, events, pt_files, af_totals, af_closures,
	existing_external_values, existing_run_club_values,
):
	worksheet = workbook.add_worksheet(person[:31])
	has_run_club = person == "Pedro Freitas"
	has_simao_commission = person == "Simão Sá"
	formats = {
		"header": workbook.add_format({
			"bold": True, "align": "center", "valign": "vcenter",
			"bg_color": "#0878bd", "border": 1,
		}),
		"subheader": workbook.add_format({
			"bold": True, "align": "center", "valign": "vcenter", "border": 1,
		}),
		"month": workbook.add_format({"border": 1}),
		"number": workbook.add_format({"border": 1, "num_format": "0"}),
		"average": workbook.add_format({
			"bold": True, "border": 1, "bg_color": "#d9e8d2", "num_format": "0.00",
		}),
		"euro": workbook.add_format({"border": 1, "num_format": "0.00 €"}),
		"percent": workbook.add_format({"border": 1, "num_format": "0.00%"}),
		"total": workbook.add_format({
			"bold": True, "border": 1, "bg_color": "#d9e8d2", "num_format": "0",
		}),
		"total_euro": workbook.add_format({
			"bold": True, "border": 1, "bg_color": "#d9e8d2", "num_format": "0.00 €",
		}),
		"total_percent": workbook.add_format({
			"bold": True, "border": 1, "bg_color": "#d9e8d2", "num_format": "0.00%",
		}),
	}

	worksheet.merge_range("A1:A2", "VENCIMENTOS " + str(year), formats["header"])
	worksheet.merge_range("B1:E1", "PT", formats["header"])
	worksheet.merge_range("F1:I1", "AF", formats["header"])
	worksheet.merge_range("J1:L1", "SALA", formats["header"])
	if has_run_club:
		worksheet.merge_range("M1:N1", "RUN CLUB", formats["header"])
		worksheet.merge_range("O1:O2", "TOTAL VENCIMENTO", formats["header"])
		worksheet.merge_range("P1:P2", "AULAS EXTERNAS", formats["header"])
	elif has_simao_commission:
		worksheet.merge_range("M1:M2", "TOTAL VENCIMENTO", formats["header"])
		worksheet.merge_range("N1:N2", "COMISSÃO SIMÃO", formats["header"])
		worksheet.merge_range("O1:O2", "AULAS EXTERNAS", formats["header"])
	else:
		worksheet.merge_range("M1:M2", "TOTAL VENCIMENTO", formats["header"])
		worksheet.merge_range("N1:N2", "AULAS EXTERNAS", formats["header"])

	headers = [
		"Horas", "Valor c/iva", "Valor s/iva", "Comissão",
		"Total AF", "Fechos AF", "% Fecho", "Comissão",
		"Horas Semana", "Horas Domingo", "Comissão",
	]
	for column, header in enumerate(headers, start=1):
		worksheet.write(1, column, header, formats["subheader"])
	if has_run_club:
		worksheet.write(1, 12, "Nº Aulas", formats["subheader"])
		worksheet.write(1, 13, "Comissão", formats["subheader"])

	months = pd.DataFrame({"month": range(1, 13), "label": MONTHS})
	row_values = []
	for row_index, month in enumerate(months.itertuples(index=False), start=2):
		excel_row = row_index + 1
		worksheet.write(row_index, 0, month.label.upper(), formats["month"])
		filename = pt_files.get(month.month)
		pt_hours, pt_value_with_vat, pt_commission = _source_values(filename, person)
		total_af = af_totals.get((person, month.month), 0)
		fechos_af = af_closures.get((person, month.month), 0)
		external_value = existing_external_values.get(person, {}).get(month.label.upper(), 0) or 0
		run_club_classes = existing_run_club_values.get(person, {}).get(month.label.upper(), 0) or 0
		pt_value_without_vat = round(pt_value_with_vat / 1.23, 2)
		weekday_saturday_hours, sunday_hours = _calendar_totals(
			events, year, month.month, person
		)
		weekday_saturday_hours = round(weekday_saturday_hours, 2)
		sunday_hours = round(sunday_hours, 2)
		sala_commission = round(weekday_saturday_hours * 7 + sunday_hours * 8.5, 2)
		run_club_commission = round(run_club_classes * 15, 2)
		percent_fecho = round(fechos_af / total_af, 4) if total_af else 0
		if percent_fecho < 0.1:
			af_commission = total_af * 3
		elif percent_fecho < 0.2:
			af_commission = total_af * 4
		else:
			af_commission = total_af * 5
		af_commission = round(af_commission, 2)
		total_vencimento = round(
			pt_commission + af_commission + sala_commission + run_club_commission + external_value,
			2,
		)
		simao_base_commission = round(pt_value_without_vat * 0.05 + af_commission, 2)
		simao_sunday_commission = round(sunday_hours * 8.5, 2)
		simao_commission = (
			round(simao_base_commission + simao_sunday_commission, 2)
			if total_vencimento >= 1500
			else simao_sunday_commission
		)
		row_values.append([
			pt_hours, pt_value_with_vat, pt_value_without_vat, pt_commission,
			total_af, fechos_af, percent_fecho, af_commission, weekday_saturday_hours, sunday_hours,
			sala_commission,
			*([run_club_classes, run_club_commission, total_vencimento, external_value]
				if has_run_club else [total_vencimento, simao_commission, external_value]
				if has_simao_commission else [total_vencimento]),
		])

		worksheet.write_number(row_index, 1, pt_hours, formats["number"])
		worksheet.write_number(row_index, 2, pt_value_with_vat, formats["euro"])
		worksheet.write_formula(row_index, 3, f"=ROUND(C{excel_row}/1.23,2)", formats["euro"], pt_value_without_vat)
		worksheet.write_number(row_index, 4, pt_commission, formats["euro"])
		worksheet.write_number(row_index, 5, total_af, formats["number"])
		worksheet.write_number(row_index, 6, fechos_af, formats["number"])
		worksheet.write_formula(row_index, 7, f"=ROUND(IFERROR(G{excel_row}/F{excel_row},0),4)", formats["percent"], percent_fecho)
		worksheet.write_formula(
			row_index, 8,
			f"=ROUND(IF(H{excel_row}<10%,F{excel_row}*3,IF(H{excel_row}<20%,F{excel_row}*4,F{excel_row}*5)),2)",
			formats["euro"], af_commission,
		)
		worksheet.write_number(row_index, 9, weekday_saturday_hours, formats["number"])
		worksheet.write_number(row_index, 10, sunday_hours, formats["number"])
		worksheet.write_formula(
			row_index, 11,
			f"=ROUND(J{excel_row}*7+K{excel_row}*8.5,2)",
			formats["euro"], sala_commission,
		)
		if has_run_club:
			worksheet.write_number(row_index, 12, run_club_classes, formats["number"])
			worksheet.write_formula(row_index, 13, f"=ROUND(M{excel_row}*15,2)", formats["euro"], run_club_commission)
			worksheet.write_formula(
				row_index, 14,
				f"=ROUND(SUM(E{excel_row},I{excel_row},L{excel_row},N{excel_row},P{excel_row}),2)",
				formats["euro"], total_vencimento,
			)
			worksheet.write_number(row_index, 15, external_value, formats["euro"])
		else:
			worksheet.write_formula(
				row_index, 12,
				(
					f"=ROUND(SUM(E{excel_row},I{excel_row},L{excel_row},O{excel_row}),2)"
					if has_simao_commission
					else f"=ROUND(SUM(E{excel_row},I{excel_row},L{excel_row},N{excel_row}),2)"
				),
				formats["euro"], total_vencimento,
			)
			if has_simao_commission:
				worksheet.write_formula(
					row_index, 13,
					f"=IF(M{excel_row}>=1500,ROUND(C{excel_row}*5%+H{excel_row},2),0)+ROUND(K{excel_row}*8.5,2)",
					formats["euro"], simao_commission,
				)
				worksheet.write_number(row_index, 14, external_value, formats["euro"])
			else:
				worksheet.write_number(row_index, 13, external_value, formats["euro"])

	total_row = 14
	average_row = 15
	worksheet.write(total_row, 0, "TOTAL", formats["total"])
	worksheet.write(average_row, 0, "MÉDIA", formats["average"])
	last_total_column = 15 if has_run_club else 14 if has_simao_commission else 13
	for column in range(1, last_total_column):
		cell = chr(ord("A") + column)
		output_format = formats["total"]
		average_format = formats["average"]
		if column in (
			(2, 3, 4, 8, 11, 13, 14)
			if has_run_club
			else (2, 3, 4, 8, 11, 13) if has_simao_commission
			else (2, 3, 4, 8, 11, 12)
		):
			output_format = formats["total_euro"]
			average_format = formats["total_euro"]
		elif column == 7:
			output_format = formats["total_percent"]
			average_format = formats["total_percent"]
		total_value = sum(values[column - 1] for values in row_values)
		average_value = total_value / len(row_values)
		worksheet.write_formula(total_row, column, f"=ROUND(SUM({cell}3:{cell}14),2)", output_format, round(total_value, 2))
		worksheet.write_formula(average_row, column, f"=ROUND(AVERAGE({cell}3:{cell}14),2)", average_format, round(average_value, 2))
	last_column = 15 if has_run_club else 14 if has_simao_commission else 13
	worksheet.write_blank(total_row, last_column, None, formats["total"])
	worksheet.write_blank(average_row, last_column, None, formats["average"])

	worksheet.set_column("A:A", 17)
	worksheet.set_column("B:B", 10)
	worksheet.set_column("C:E", 14)
	worksheet.set_column("F:H", 12)
	worksheet.set_column("I:I", 14)
	worksheet.set_column("J:L", 15)
	worksheet.set_column(
		"M:P" if has_run_club else "M:O" if has_simao_commission else "M:N",
		18,
	)
	worksheet.freeze_panes(2, 1)


def generate_vencimento(year=None, events=None):
	"""Create the annual workbook and return its filename."""
	import app

	if year is None:
		years = [
			int(match.group(1))
			for filename in _pt_files()
			if (match := re.fullmatch(r"PT_.+(\d{4})\.xlsx", filename))
		]
		year = max(years, default=datetime.now().year)
	if events is None:
		events_path = os.path.join(BACKEND_DIR, "events.json")
		try:
			with open(events_path, encoding="utf-8") as events_file:
				events = json.load(events_file)
		except (FileNotFoundError, json.JSONDecodeError):
			events = []

	output_filename = os.path.join(BACKEND_DIR, f"{OUTPUT_PREFIX}{year}.xlsx")
	temporary_filename = (
		f"{output_filename}.{os.getpid()}.{threading.get_ident()}.tmp.xlsx"
	)
	with WORKBOOK_LOCK:
		try:
			with pd.ExcelWriter(temporary_filename, engine="xlsxwriter") as writer:
				pt_files = _pt_file_by_month(year)
				af_files = _af_file_by_month(year)
				af_totals, af_closures = _af_status_totals(af_files, year)
				existing_external_values = _existing_external_values(year)
				existing_run_club_values = _existing_run_club_values(year)
				for person in app.PEOPLE:
					_write_sheet(
						writer.book, person, year, events, pt_files, af_totals,
						af_closures, existing_external_values, existing_run_club_values,
					)
			os.replace(temporary_filename, output_filename)
		finally:
			if os.path.exists(temporary_filename):
				os.remove(temporary_filename)
	return os.path.basename(output_filename)
