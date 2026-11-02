// backend/src/modules/schedule/schedule.controller.js

import scheduleService from './schedule.service.js';

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, e)                  => res.status(e.statusCode || 500).json({ success: false, message: e.message });

class ScheduleController {

  async create(req, res) {
    try {
      const schedule = await scheduleService.createSchedule(req.user.userId, req.body);
      ok(res, schedule, 201);
    } catch (e) { err(res, e); }
  }

  async getAll(req, res) {
    try {
      const { upcoming } = req.query;
      const schedules = await scheduleService.getTeacherSchedules(req.user.userId, {
        upcoming: upcoming === 'true',
      });
      ok(res, schedules);
    } catch (e) { err(res, e); }
  }

  async getUpcoming(req, res) {
    try {
      const schedules = await scheduleService.getUpcomingSchedules(req.user.userId);
      ok(res, schedules);
    } catch (e) { err(res, e); }
  }

  async update(req, res) {
    try {
      const schedule = await scheduleService.updateSchedule(
        req.params.id, req.user.userId, req.body,
      );
      ok(res, schedule);
    } catch (e) { err(res, e); }
  }

  async remove(req, res) {
    try {
      const result = await scheduleService.deleteSchedule(req.params.id, req.user.userId);
      ok(res, result);
    } catch (e) { err(res, e); }
  }
}

export default new ScheduleController();