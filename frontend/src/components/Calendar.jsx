import { useEffect, useRef, useState } from 'react';
import FullCalendar from "@fullcalendar/react";
import themePlugin from "@fullcalendar/react/themes/monarch";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from '@fullcalendar/react/timegrid'
import ptLocale from '@fullcalendar/react/locales/pt'
import interactionPlugin from '@fullcalendar/react/interaction';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/monarch/theme.css';
import '@fullcalendar/react/themes/monarch/palettes/purple.css';

const EVENTS_API_URL = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/events`;
const WEEKLY_HOURS_API_URL = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/weekly-hours`;
const MONTHLY_HOURS_API_URL = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/monthly-hours`;
let rememberedCalendarDate = null;

const personColors = {
  'André Mota': '#2563eb',
  'Daniel Araújo': '#0891b2',
  'Emanuel Ferreira': '#9333ea',
  'Pedro Freitas': '#ea580c',
  'Rúben Ramos': '#dc2626',
  'Simão Sá': '#16a34a',
};

const isWithinWorkingHours = (date) => {
  const minutes = date.getHours() * 60 + date.getMinutes();

  return minutes >= 6 * 60 && minutes <= 22 * 60;
};

const isSameDay = (start, end) => (
  start.getFullYear() === end.getFullYear() &&
  start.getMonth() === end.getMonth() &&
  start.getDate() === end.getDate()
);

const shiftDateByDays = (value, days) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};

const getEasterSunday = (year) => {
  const century = Math.floor(year / 100);
  const yearInCentury = year % 100;
  const leapYears = Math.floor(century / 4);
  const centuryRemainder = century % 4;
  const moonCorrection = Math.floor((century + 8) / 25);
  const calendarCorrection = Math.floor((century - moonCorrection + 1) / 3);
  const goldenNumber = year % 19;
  const moonPhase = (
    19 * goldenNumber + century - leapYears - calendarCorrection + 15
  ) % 30;
  const leapYearInCentury = Math.floor(yearInCentury / 4);
  const yearRemainder = yearInCentury % 4;
  const weekdayCorrection = (
    32 + 2 * centuryRemainder + 2 * leapYearInCentury - moonPhase - yearRemainder
  ) % 7;
  const dateCorrection = Math.floor((goldenNumber + 11 * moonPhase + 22 * weekdayCorrection) / 451);
  const month = Math.floor((moonPhase + weekdayCorrection - 7 * dateCorrection + 114) / 31);
  const day = ((moonPhase + weekdayCorrection - 7 * dateCorrection + 114) % 31) + 1;

  return new Date(year, month - 1, day);
};

const formatDateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const getPortugueseHolidayEvents = (range) => {
  if (!range) {
    return [];
  }

  const lastVisibleDate = new Date(range.end);
  lastVisibleDate.setDate(lastVisibleDate.getDate() - 1);
  const holidays = [];

  for (let year = range.start.getFullYear(); year <= lastVisibleDate.getFullYear(); year += 1) {
    const easterSunday = getEasterSunday(year);
    const holidaysForYear = [
      [new Date(year, 0, 1), 'Ano Novo'],
      [shiftDateByDays(easterSunday, -2), 'Sexta-feira Santa'],
      [easterSunday, 'Domingo de Páscoa'],
      [new Date(year, 3, 25), 'Dia da Liberdade'],
      [new Date(year, 4, 1), 'Dia do Trabalhador'],
      [shiftDateByDays(easterSunday, 60), 'Corpo de Deus'],
      [new Date(year, 5, 10), 'Dia de Portugal'],
      [new Date(year, 7, 15), 'Assunção de Nossa Senhora'],
      [new Date(year, 9, 5), 'Implantação da República'],
      [new Date(year, 10, 1), 'Dia de Todos os Santos'],
      [new Date(year, 11, 1), 'Restauração da Independência'],
      [new Date(year, 11, 8), 'Imaculada Conceição'],
      [new Date(year, 11, 25), 'Natal']
    ];

    holidaysForYear.forEach(([date, title]) => {
      if (date >= range.start && date < range.end) {
        const dateKey = formatDateKey(date);
        holidays.push({
          id: `holiday-${dateKey}`,
          title: '',
          holidayTitle: title,
          start: `${dateKey}T06:00:00`,
          end: `${dateKey}T22:00:00`,
          allDay: false,
          editable: false,
          display: 'background',
          category: 'holiday',
          backgroundColor: 'rgba(245, 158, 11, 0.14)',
          borderColor: '#f59e0b',
          textColor: '#78350f',
          classNames: ['calendar-holiday-event']
        });
      }
    });
  }

  return holidays;
};

const getWeekNumberInMonth = (date) => {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthStartDay = (monthStart.getDay() + 6) % 7;
  const firstWeekStart = new Date(monthStart);
  firstWeekStart.setDate(monthStart.getDate() - monthStartDay);

  return Math.floor((date - firstWeekStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
};

const formatMonthAndYear = (date) => new Intl.DateTimeFormat('pt-PT', {
  month: 'long',
  year: 'numeric'
}).format(date);

const getCalendarTitle = (start, end = null) => {
  const endDate = end ? new Date(end) : start;
  if (end) {
    endDate.setDate(endDate.getDate() - 1);
  }

  if (
    start.getMonth() !== endDate.getMonth() ||
    start.getFullYear() !== endDate.getFullYear()
  ) {
    const startMonth = `${formatMonthAndYear(start)} (Semana ${getWeekNumberInMonth(start)})`;
    const endMonth = `${formatMonthAndYear(endDate)} (Semana ${getWeekNumberInMonth(endDate)})`;

    return `${startMonth} - ${endMonth}`;
  }

  const monthAndYear = new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric'
  }).format(start);

  return `${monthAndYear} (Semana ${getWeekNumberInMonth(start)})`;
};

const getWeeklyHoursKey = (date) => {
  const weekNumber = getWeekNumberInMonth(date);
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${date.getFullYear()}-${month}-week-${weekNumber}`;
};

const getWeeklySummaryTitle = (week) => {
  const date = new Date(`${week.week_start}T00:00:00`);
  const monthAndYear = new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric'
  }).format(date);

  return `${monthAndYear} (Semana ${week.week_number})`;
};

const formatSummaryHours = (person, period, value) => {
  const hours = Number(value) || 0;

  if (person === 'Simão Sá' && period === 'Dias úteis' && hours > 0) {
    return `${hours}h (${hours - 3}h + 3h)`;
  }

  return `${hours}h`;
};

const Calendar = () => {
  const [events, setEvents] = useState([]);
  const [calendarTitle, setCalendarTitle] = useState(getCalendarTitle(new Date()));
  const [eventSelection, setEventSelection] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [createPosition, setCreatePosition] = useState(null);
  const [editPosition, setEditPosition] = useState(null);
  const [weeklyHours, setWeeklyHours] = useState([]);
  const [currentWeekKeys, setCurrentWeekKeys] = useState([
    getWeeklyHoursKey(new Date())
  ]);
  const [currentMonth, setCurrentMonth] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1
  });
  const [monthlyHours, setMonthlyHours] = useState(null);
  const [showMonthlyTotals, setShowMonthlyTotals] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [currentWeekRange, setCurrentWeekRange] = useState(null);

  useEffect(() => {
    fetch(EVENTS_API_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Não foi possível carregar os eventos');
        }
        return response.json();
      })
      .then(setEvents)
      .catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    if (!eventSelection || selectedEvent) {
      return undefined;
    }

    const frameId = requestAnimationFrame(() => {
      const container = calendarContainerRef.current;
      const selectionElement = container?.querySelector('.fc-highlight');
      const selectionRect = selectionElement?.getBoundingClientRect();
      if (!container || !selectionRect) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const dialogWidth = Math.min(320, containerRect.width - 32);
      const maxLeft = containerRect.width - dialogWidth - 16;
      setCreatePosition({
        top: selectionRect.top - containerRect.top,
        left: Math.max(
          16,
          Math.min(selectionRect.left - containerRect.left, maxLeft)
        )
      });
    });

    return () => cancelAnimationFrame(frameId);
  }, [eventSelection, selectedEvent]);

  const people = [
    'André Mota',
    'Daniel Araújo',
    'Emanuel Ferreira',
    'Pedro Freitas',
    'Rúben Ramos',
    'Simão Sá',
  ];

  const handleSelect = (info) => {
    if (selectedEvent) {
      return;
    }

    const containerRect = calendarContainerRef.current.getBoundingClientRect();
    const dialogWidth = Math.min(320, containerRect.width - 32);
    const selectionLeft = info.jsEvent
      ? info.jsEvent.clientX - containerRect.left
      : containerRect.width / 2;
    const selectionTop = info.jsEvent
      ? info.jsEvent.clientY - containerRect.top
      : 65;
    const maxLeft = containerRect.width - dialogWidth - 16;

    setEventSelection(info);
    setCreatePosition({
      top: selectionTop,
      left: Math.max(16, Math.min(selectionLeft, maxLeft))
    });
    setSelectedPerson('');
  };

  const createEvent = async () => {
    if (!selectedPerson || !eventSelection) {
      return;
    }

    const event = {
      title: selectedPerson,
      start: eventSelection.start,
      end: eventSelection.end,
      color: personColors[selectedPerson]
    };

    setSavingEvent(true);
    try {
      const response = await fetch(EVENTS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      if (!response.ok) throw new Error('Não foi possível guardar o evento');
      const savedEvent = await response.json();
      setEvents((prev) => [...prev, savedEvent]);
      setCalendarVersion((version) => version + 1);
      await loadWeeklySummary(currentWeekKeys);
      setEventSelection(null);
      setCreatePosition(null);
      calendarRef.current.getApi().unselect();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingEvent(false);
    }
  };

  const cancelEventSelection = () => {
    setEventSelection(null);
    setCreatePosition(null);
    calendarRef.current.getApi().unselect();
  };

  const handleEventClick = (info) => {
    if (savingEvent) {
      return;
    }

    if (info.event.extendedProps.category === 'holiday') {
      setEventSelection(null);
      setCreatePosition(null);
      setSelectedEvent(null);
      setEditPosition(null);
      calendarRef.current.getApi().unselect();
      return;
    }

    const eventRect = info.el.getBoundingClientRect();
    const containerRect = calendarContainerRef.current.getBoundingClientRect();
    const dialogWidth = Math.min(320, containerRect.width - 32);
    const eventLeft = eventRect.left - containerRect.left;
    const maxLeft = containerRect.width - dialogWidth - 16;

    setEventSelection(null);
    setCreatePosition(null);
    setSelectedEvent(info.event);
    setSelectedPerson(info.event.title);
    setEditPosition({
      top: eventRect.top - containerRect.top,
      left: Math.max(16, Math.min(eventLeft, maxLeft))
    });
    calendarRef.current.getApi().unselect();
  };

  const syncEventDates = async ({ event, revert }) => {
    const changes = { start: event.start, end: event.end };

    setSavingEvent(true);
    try {
      const response = await fetch(`${EVENTS_API_URL}/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes)
      });
      if (!response.ok) throw new Error('Não foi possível guardar a alteração');
      const savedEvent = await response.json();
      setEvents((prev) => prev.map((currentEvent) => (
        currentEvent.id === savedEvent.id ? savedEvent : currentEvent
      )));
      setCalendarVersion((version) => version + 1);
      await loadWeeklySummary(currentWeekKeys);
    } catch (error) {
      console.error(error);
      revert();
    } finally {
      setSavingEvent(false);
    }
  };

  const updateEvent = async () => {
    if (!selectedPerson || !selectedEvent) {
      return;
    }

    const changes = {
      title: selectedPerson,
      color: personColors[selectedPerson]
    };

    setSavingEvent(true);
    try {
      const response = await fetch(`${EVENTS_API_URL}/${selectedEvent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes)
      });
      if (!response.ok) throw new Error('Não foi possível atualizar o evento');
      const savedEvent = await response.json();
      setEvents((prev) => prev.map((event) => (
        event.id === savedEvent.id ? savedEvent : event
      )));
      setCalendarVersion((version) => version + 1);
      await loadWeeklySummary(currentWeekKeys);
      setSelectedEvent(null);
      setEditPosition(null);
    } catch (error) {
      console.error(error);
    } finally {
      setSavingEvent(false);
    }
  };

  const deleteEvent = async () => {
    if (!selectedEvent) {
      return;
    }

    setSavingEvent(true);
    try {
      const response = await fetch(`${EVENTS_API_URL}/${selectedEvent.id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Não foi possível apagar o evento');
      setEvents((prev) => prev.filter((event) => event.id !== selectedEvent.id));
      setCalendarVersion((version) => version + 1);
      await loadWeeklySummary(currentWeekKeys);
      setSelectedEvent(null);
      setEditPosition(null);
    } catch (error) {
      console.error(error);
    } finally {
      setSavingEvent(false);
    }
  };

  const calendarRef = useRef(null);
  const calendarContainerRef = useRef(null);
  const [showMonths, setShowMonths] = useState(false);

  const months = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];

  const selectMonth = (month) => {
    const calendarApi = calendarRef.current.getApi();

    const currentYear = calendarApi.getDate().getFullYear();

    calendarApi.gotoDate(new Date(currentYear, month, 1));

    setShowMonths(false);
  };

  const updateCalendarTitle = ({ start, end }) => {
    const displayedDate = new Date(start);
    const calendarDate = calendarRef.current?.getApi().getDate() || displayedDate;
    rememberedCalendarDate = [
      calendarDate.getFullYear(),
      String(calendarDate.getMonth() + 1).padStart(2, '0'),
      String(calendarDate.getDate()).padStart(2, '0')
    ].join('-');
    const displayedEnd = new Date(end);
    displayedEnd.setDate(displayedEnd.getDate() - 1);
    const weekKeys = [getWeeklyHoursKey(displayedDate)];
    const endWeekKey = getWeeklyHoursKey(displayedEnd);
    if (endWeekKey !== weekKeys[0]) {
      weekKeys.push(endWeekKey);
    }

    setCalendarTitle(getCalendarTitle(displayedDate, end));
    setCurrentWeekRange({ start, end });

    setCurrentWeekKeys(weekKeys);
    setCurrentMonth({
      year: calendarDate.getFullYear(),
      month: calendarDate.getMonth() + 1
    });
    loadWeeklySummary(weekKeys);
  };

  const loadWeeklySummary = async (weekKeys) => {
    try {
      const response = await fetch(WEEKLY_HOURS_API_URL);
      if (!response.ok) throw new Error('Não foi possível carregar o resumo semanal');
      const report = await response.json();
      setWeeklyHours(weekKeys
        .map((weekKey) => report[weekKey] && { key: weekKey, data: report[weekKey] })
        .filter(Boolean));
    } catch (error) {
      console.error(error);
    }
  };

  const loadMonthlyTotals = async (year = currentMonth.year, month = currentMonth.month) => {
    try {
      const response = await fetch(
        `${MONTHLY_HOURS_API_URL}?year=${year}&month=${month}`
      );
      if (!response.ok) throw new Error('Não foi possível carregar o total mensal');
      const report = await response.json();
      setMonthlyHours(report);
      setShowMonthlyTotals(true);
    } catch (error) {
      console.error(error);
    }
  };

  const duplicatePreviousWeek = async () => {
    if (!currentWeekRange || savingEvent) {
      return;
    }

    const previousStart = shiftDateByDays(currentWeekRange.start, -7);
    const previousEnd = shiftDateByDays(currentWeekRange.end, -7);
    const eventsToCopy = events.filter((event) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventStart < previousEnd && eventEnd > previousStart;
    });
    if (!eventsToCopy.length) {
      return;
    }

    setSavingEvent(true);
    const copiedEvents = [];
    try {
      for (const event of eventsToCopy) {
        const copiedEvent = { ...event };
        delete copiedEvent.id;
        delete copiedEvent.dayOfWeek;
        copiedEvent.start = shiftDateByDays(event.start, 7);
        copiedEvent.end = shiftDateByDays(event.end, 7);
        const response = await fetch(EVENTS_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(copiedEvent)
        });
        if (!response.ok) {
          throw new Error('Não foi possível duplicar os eventos da semana anterior');
        }
        copiedEvents.push(await response.json());
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (copiedEvents.length) {
        setEvents((previousEvents) => [...previousEvents, ...copiedEvents]);
        setCalendarVersion((version) => version + 1);
        await loadWeeklySummary(currentWeekKeys);
      }
      setSavingEvent(false);
    }
  };

  const changeMonthlyMonth = (offset) => {
    const date = new Date(currentMonth.year, currentMonth.month - 1 + offset, 1);
    calendarRef.current.getApi().gotoDate(date);
    loadMonthlyTotals(date.getFullYear(), date.getMonth() + 1);
  };

  const currentWeekHasEvents = currentWeekRange && events.some((event) => (
    new Date(event.start) < currentWeekRange.end &&
    new Date(event.end) > currentWeekRange.start
  ));
  const previousWeekHasEvents = currentWeekRange && events.some((event) => (
    new Date(event.start) < shiftDateByDays(currentWeekRange.end, -7) &&
    new Date(event.end) > shiftDateByDays(currentWeekRange.start, -7)
  ));
  const calendarEvents = [
    ...events,
    ...getPortugueseHolidayEvents(currentWeekRange)
  ];

  return (
    <div className="calendar-container" ref={calendarContainerRef}>
      {savingEvent && <div className="calendar-save-blocker" aria-hidden="true" />}
      {eventSelection && (
        <div
          className="event-picker create-event-picker"
          role="dialog"
          aria-label="Escolher pessoa"
          style={createPosition || undefined}
        >
          <label htmlFor="person-select">Escolha um PT</label>
          <select
            id="person-select"
            value={selectedPerson}
            onChange={(event) => setSelectedPerson(event.target.value)}
            disabled={savingEvent}
          >
            <option value="">Selecione...</option>
            {people.map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
          </select>
          <div className="event-picker-actions">
            {savingEvent ? <span className="event-saving-status">A guardar...</span> : (
              <>
                <button type="button" onClick={cancelEventSelection}>
                  Cancelar
                </button>
                <button type="button" onClick={createEvent} disabled={!selectedPerson}>
                  Criar evento
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedEvent && (
        <div
          className="event-picker edit-event-picker"
          role="dialog"
          aria-label="Editar evento"
          style={editPosition || undefined}
        >
          <label htmlFor="edit-person-select">Editar PT</label>
          <select
            id="edit-person-select"
            value={selectedPerson}
            onChange={(event) => setSelectedPerson(event.target.value)}
            disabled={savingEvent}
          >
            {people.map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
          </select>
          <div className="event-picker-actions">
            {savingEvent ? <span className="event-saving-status">A guardar...</span> : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEvent(null);
                    setEditPosition(null);
                  }}
                >
                  Cancelar
                </button>
                <button type="button" onClick={deleteEvent}>
                  Apagar
                </button>
                <button type="button" onClick={updateEvent}>
                  Guardar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showMonths && (
        <div className="month-picker">
          {months.map((month, index) => (
            <button
              key={month}
              onClick={() => selectMonth(index)}
            >
              {month}
            </button>
          ))}
        </div>
      )}

    <FullCalendar
      ref={calendarRef}
      key={calendarVersion}
      plugins={[themePlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      initialDate={rememberedCalendarDate || undefined}
      locale={ptLocale}
      firstDay={1}
      buttons={{
        duplicateWeek: {
          text: 'Duplicar Semana Anterior',
          click: () => duplicatePreviousWeek()
        },
        monthPicker: {
          text: 'Mês',
          click: () => setShowMonths((isVisible) => !isVisible)
        },
        monthlyTotals: {
          text: 'Total Mensal',
          click: () => loadMonthlyTotals()
        }
      }}
      toolbarElements={{
        calendarTitle: () => (
          <span className="calendar-title-element">{calendarTitle}</span>
        )
      }}
      headerToolbar={{
        right: `${currentWeekRange && !currentWeekHasEvents && previousWeekHasEvents ? 'duplicateWeek ' : ''}monthlyTotals monthPicker today prev,next`,
        left: 'calendarTitle'
      }}
      slotMinTime="06:00:00"
      slotDuration="01:00:00"
      slotMaxTime="22:00:00"
      allDayText=""
      slotHeaderFormat={{
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }}
      dayHeaderContent={(info) => {
        const holiday = calendarEvents.find((event) => (
          event.category === 'holiday' &&
          event.start.slice(0, 10) === formatDateKey(info.date)
        ));

        return (
          <div className="calendar-day-heading">
            <span>{info.text}</span>
            {holiday && <span className="calendar-holiday-label">{holiday.holidayTitle}</span>}
          </div>
        );
      }}
      allDaySlot={false}
      height="auto"
      events={calendarEvents}
      selectable={!selectedEvent && !savingEvent}
      selectOverlap={(event) => event.extendedProps.category === 'holiday'}
      selectMirror={true}
      unselectAuto={false}
      editable={!savingEvent}
      eventStartEditable={!savingEvent}
      eventDurationEditable={!savingEvent}
      eventResizableFromStart={!savingEvent}
      eventOverlap={(existingEvent, movingEvent) => (
        existingEvent.extendedProps.category === 'holiday' ||
        movingEvent.extendedProps.category === 'holiday'
      )}
      eventAllow={(dropInfo) => (
        isWithinWorkingHours(dropInfo.start) &&
        dropInfo.end !== null &&
        isWithinWorkingHours(dropInfo.end)
      )}
      selectAllow={(selectInfo) => (
        selectInfo.end !== null &&
        isSameDay(selectInfo.start, selectInfo.end) &&
        isWithinWorkingHours(selectInfo.start) &&
        isWithinWorkingHours(selectInfo.end)
      )}
      select={handleSelect}
      eventClick={handleEventClick}
      eventDrop={syncEventDates}
      eventResize={syncEventDates}
      datesSet={updateCalendarTitle}
    />

      <div className="weekly-summary" role="region" aria-label="Resumo Semanal">
        {weeklyHours.map(({ key, data }) => (
          <div className="weekly-summary-table" key={key}>
            <h2>{getWeeklySummaryTitle(data)}</h2>
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  {people.map((person) => <th key={person}>{person}</th>)}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Dias úteis', data.weekday_hours],
                  ['Sábado', data.saturday_hours],
                  ['Domingo', data.sunday_hours]
                ].map(([period, hours]) => (
                  <tr key={period}>
                    <th>{period}</th>
                    {people.map((person) => (
                      <td key={person}>{formatSummaryHours(person, period, hours?.[person])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showMonthlyTotals && monthlyHours && (
        <div className="monthly-summary" role="dialog" aria-label="Total Mensal">
          <div className="monthly-summary-header">
            <div className="monthly-summary-month-controls">
              <button
                type="button"
                onClick={() => changeMonthlyMonth(-1)}
                aria-label="Mês anterior"
              >
                ‹
              </button>
              <h2>{formatMonthAndYear(new Date(currentMonth.year, currentMonth.month - 1, 1))}</h2>
              <button
                type="button"
                onClick={() => changeMonthlyMonth(1)}
                aria-label="Mês seguinte"
              >
                ›
              </button>
            </div>
            <button type="button" onClick={() => setShowMonthlyTotals(false)} aria-label="Fechar">
              Fechar
            </button>
          </div>
          <div className="monthly-summary-table">
            <table>
              <thead>
                <tr>
                  <th>PT</th>
                  <th>Horas Semana</th>
                  <th>Horas Sábado</th>
                  <th>Horas Domingo</th>
                  <th>Valor Semana + Sábado</th>
                  <th>Valor Domingo</th>
                  <th>Valor Total</th>
                </tr>
              </thead>
              <tbody>
                {monthlyHours.totals
                  .slice()
                  .sort((first, second) => first.person.localeCompare(second.person, 'pt-PT'))
                  .map((totals) => (
                  <tr key={totals.person}>
                    <th>{totals.person}</th>
                    <td>{totals.weekday_hours.toFixed(0)}h</td>
                    <td>{totals.saturday_hours.toFixed(0)}h</td>
                    <td>{totals.sunday_hours.toFixed(0)}h</td>
                    <td>{totals.weekday_saturday_value.toFixed(2)}€</td>
                    <td>{totals.sunday_value.toFixed(2)}€</td>
                    <td>{totals.total_value.toFixed(2)}€</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan="6">Total</th>
                  <th>
                    {monthlyHours.totals
                      .reduce((sum, totals) => sum + totals.total_value, 0)
                      .toFixed(2)}€
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Calendar