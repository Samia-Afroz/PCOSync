// backend/routes/dailyCheckIn.js
import express from 'express';
import UserActivity from '../models/UserActivity.js';
import ProgressReport from '../models/ProgressReport.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// @route   POST /api/daily-checkin
// @desc    Save daily check-in
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { date, tasks, notes } = req.body;
    const userId = req.user.id;

    let activity = await UserActivity.findOne({
      userId,
      date: {
        $gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
        $lt: new Date(new Date(date).setHours(23, 59, 59, 999))
      }
    });

    const activityData = {
      userId,
      date: new Date(date),
      exercise: {
        completed: tasks.exerciseDone,
        type: tasks.exerciseType,
        duration: tasks.exerciseDuration,
        calories: tasks.exerciseDuration * 5
      },
      mood: {
        rating: tasks.moodRating,
        emoji: tasks.moodEmoji,
        confidence: tasks.moodRating * 2,
        journalEntry: tasks.journalWritten ? notes : null
      },
      diet: {
        meals: [
          tasks.breakfastEaten ? { name: 'Breakfast', calories: 400, time: new Date() } : null,
          tasks.lunchEaten ? { name: 'Lunch', calories: 600, time: new Date() } : null,
          tasks.dinnerEaten ? { name: 'Dinner', calories: 700, time: new Date() } : null
        ].filter(Boolean),
        totalCalories: 
          (tasks.breakfastEaten ? 400 : 0) + 
          (tasks.lunchEaten ? 600 : 0) + 
          (tasks.dinnerEaten ? 700 : 0),
        waterIntake: tasks.waterGlasses,
        nutrition: {
          protein: 60,
          carbs: 180,
          fats: 50
        }
      },
      menstrualCycle: {
        isPeriod: tasks.periodTracked,
        symptoms: tasks.symptomsTracked ? ['tracked'] : []
      },
      streakDay: tasks.upgradeToProgressReport || calculateStreakDay(tasks),
      checkInData: {
        tasks,
        notes,
        completionPercentage: calculateCompletion(tasks)
      }
    };

    if (activity) {
      Object.assign(activity, activityData);
      await activity.save();
    } else {
      activity = new UserActivity(activityData);
      await activity.save();
    }

    // After saving activity, sync all related ProgressReports for different time ranges
    try {
      await syncProgressReports(userId, activity.date);
    } catch (err) {
      console.error('Error syncing progress reports:', err);
    }

    res.json({ 
      message: 'Daily check-in saved successfully', 
      activity,
      completionPercentage: calculateCompletion(tasks)
    });
  } catch (error) {
    console.error('Error saving daily check-in:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/daily-checkin/:date
// @desc    Get check-in for specific date
// @access  Private
router.get('/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.user.id;

    const activity = await UserActivity.findOne({
      userId,
      date: {
        $gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
        $lt: new Date(new Date(date).setHours(23, 59, 59, 999))
      }
    });

    if (!activity) {
      return res.status(404).json({ message: 'No check-in found for this date' });
    }

    res.json({
      date: activity.date,
      tasks: activity.checkInData?.tasks || reconstructTasks(activity),
      notes: activity.checkInData?.notes || activity.mood?.journalEntry || ''
    });
  } catch (error) {
    console.error('Error fetching check-in:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

function calculateStreakDay(tasks) {
  if (!tasks) return false;
  const completedTasks = [
    tasks.exerciseDone,
    tasks.moodLogged,
    tasks.breakfastEaten,
    tasks.lunchEaten,
    tasks.dinnerEaten,
    tasks.waterGoalMet
  ].filter(Boolean).length;

  return completedTasks >= 4;
}

function calculateCompletion(tasks) {
  if (!tasks) return 0;
  const totalTasks = [
    tasks.exerciseDone,
    tasks.moodLogged,
    tasks.journalWritten,
    tasks.breakfastEaten,
    tasks.lunchEaten,
    tasks.dinnerEaten,
    tasks.waterGoalMet,
    tasks.medicationTaken,
    tasks.symptomsTracked,
    tasks.skinCareRoutine,
    tasks.upgradeToProgressReport
  ];
  
  const completed = totalTasks.filter(Boolean).length;
  return Math.round((completed / totalTasks.length) * 100);
}

function reconstructTasks(activity) {
  return {
    exerciseDone: activity.exercise?.completed || false,
    exerciseType: activity.exercise?.type || 'cardio',
    exerciseDuration: activity.exercise?.duration || 30,
    moodLogged: activity.mood?.rating ? true : false,
    moodRating: activity.mood?.rating || 3,
    moodEmoji: activity.mood?.emoji || '😐',
    journalWritten: activity.mood?.journalEntry ? true : false,
    breakfastEaten: activity.diet?.meals?.some(m => m.name === 'Breakfast') || false,
    lunchEaten: activity.diet?.meals?.some(m => m.name === 'Lunch') || false,
    dinnerEaten: activity.diet?.meals?.some(m => m.name === 'Dinner') || false,
    waterGoalMet: activity.diet?.waterIntake >= 8,
    waterGlasses: activity.diet?.waterIntake || 0,
    medicationTaken: false,
    symptomsTracked: activity.menstrualCycle?.symptoms?.length > 0,
    periodTracked: activity.menstrualCycle?.isPeriod || false,
    skinCareRoutine: false,
    sleepQuality: 3,
    stressLevel: 3,
    upgradeToProgressReport: activity.streakDay || false
  };
}

export default router;

async function syncProgressReports(userId, activityDate) {
  if (!userId || !activityDate) return;

  // Define all time ranges to sync
  const timeRanges = [
    { days: 7, label: '7-day' },
    { days: 30, label: '30-day' },
    { days: 90, label: '90-day' },
    { days: 365, label: '365-day' }
  ];

  // Sync each time range
  for (const range of timeRanges) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (range.days - 1));

    // Only sync if the activity date falls within this range
    if (activityDate >= startDate && activityDate <= endDate) {
      await updateProgressReportForRange(userId, startDate, endDate, activityDate);
    }
  }
}

async function updateProgressReportForRange(userId, startDate, endDate, activityDate) {
  // Find or create the progress report for this range
  let report = await ProgressReport.findOne({
    userId,
    startDate: { $lte: startDate },
    endDate: { $gte: endDate }
  });

  if (!report) {
    report = new ProgressReport({
      userId,
      startDate: new Date(startDate),
      endDate: new Date(endDate)
    });
  }

  // Fetch all activities in the report window
  const activities = await UserActivity.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: 1 });

  if (!activities || activities.length === 0) {
    await report.save();
    return;
  }

  // ===== STREAK DATA =====
  const byDate = new Map();
  activities.forEach(a => byDate.set(new Date(a.date).toDateString(), !!a.streakDay));
  
  let currentStreak = 0;
  let d = new Date(endDate);
  while (true) {
    const key = new Date(d).toDateString();
    if (byDate.get(key)) {
      currentStreak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  
  const sortedDates = Array.from(new Set(activities.map(a => new Date(a.date).toDateString()))).sort((a, b) => new Date(a) - new Date(b));
  let longestStreak = 0;
  let curr = 0;
  sortedDates.forEach(ds => {
    const val = byDate.get(ds);
    if (val) { curr++; longestStreak = Math.max(longestStreak, curr); } else { curr = 0; }
  });
  
  report.currentStreak = currentStreak;
  report.longestStreak = Math.max(report.longestStreak || 0, longestStreak);

  const midIndex = Math.floor(activities.length / 2);
  const firstHalfStreaks = activities.slice(0, midIndex).filter(a => a.streakDay).length;
  const secondHalfStreaks = activities.slice(midIndex).filter(a => a.streakDay).length;
  const firstHalfAvg = firstHalfStreaks / Math.max(midIndex, 1);
  const secondHalfAvg = secondHalfStreaks / Math.max(activities.length - midIndex, 1);
  report.streakTrend = firstHalfAvg === 0 ? 0 : Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100);

  // ===== MOOD DATA =====
  const moodActivities = activities.filter(a => a.mood?.rating);
  const weeklyMood = {};
  let totalMood = 0;
  let moodCount = 0;
  let journalCount = 0;

  moodActivities.forEach((activity, index) => {
    const weekNum = Math.floor(index / 7) + 1;
    const weekKey = `Week ${weekNum}`;
    if (!weeklyMood[weekKey]) weeklyMood[weekKey] = { total: 0, count: 0 };

    const rating = activity.mood.rating || 3;
    weeklyMood[weekKey].total += rating;
    weeklyMood[weekKey].count++;

    totalMood += rating;
    moodCount++;

    if (activity.mood.journalEntry?.trim()) journalCount++;
  });

  const moodEmojis = ['😢', '😕', '😐', '🙂', '😊'];
  const avgMoodRating = moodCount ? Math.round(totalMood / moodCount) : 3;

  const weekly = Object.keys(weeklyMood).map((week) => {
    const avg = weeklyMood[week].total / weeklyMood[week].count;
    return {
      week,
      mood: Math.round(avg * 20),
      emoji: moodEmojis[Math.round(avg) - 1] || '😐'
    };
  });

  let moodTrend = 0;
  if (weekly.length >= 2) {
    const firstWeekAvg = weekly[0].mood;
    const lastWeekAvg = weekly[weekly.length - 1].mood;
    if (firstWeekAvg === 0) moodTrend = 0;
    else moodTrend = Math.round(((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100);
  }

  report.averageMood = moodEmojis[avgMoodRating - 1] || '😐';
  report.moodData = { weekly };
  report.journalCount = journalCount;
  report.moodTrend = moodTrend;

  // ===== EXERCISE DATA =====
  const exerciseCounts = {};
  const exerciseIcons = {
    cardio: '🏃',
    yoga: '🧘',
    strength: '💪',
    other: '🏋️'
  };
  const exerciseColors = {
    cardio: '#10b981',
    yoga: '#8b5cf6',
    strength: '#3b82f6',
    other: '#f59e0b'
  };

  activities.forEach(a => {
    if (a.exercise?.completed) {
      const type = a.exercise.type || 'other';
      const name = type.charAt(0).toUpperCase() + type.slice(1);
      exerciseCounts[name] = (exerciseCounts[name] || 0) + 1;
    }
  });

  const exercises = Object.entries(exerciseCounts).map(([name, sessions]) => ({
    name,
    sessions,
    icon: exerciseIcons[name.toLowerCase()] || '🏋️',
    color: exerciseColors[name.toLowerCase()] || '#6b7280'
  }));

  const totalExerciseSessions = exercises.reduce((sum, ex) => sum + ex.sessions, 0);
  report.exerciseData = {
    exercises,
    goal: 20,
    weeklyGoal: 5
  };

  // ===== GOAL PROGRESS =====
  const completions = activities.map(a => 
    (a.checkInData && typeof a.checkInData.completionPercentage === 'number') ? a.checkInData.completionPercentage : 0
  );
  const avgCompletion = completions.length ? Math.round(completions.reduce((s, v) => s + v, 0) / completions.length) : 0;
  report.goalProgress = avgCompletion;

  const firstHalfCompletions = completions.slice(0, midIndex);
  const secondHalfCompletions = completions.slice(midIndex);
  const firstHalfGoal = firstHalfCompletions.length ? firstHalfCompletions.reduce((s, v) => s + v, 0) / firstHalfCompletions.length : 0;
  const secondHalfGoal = secondHalfCompletions.length ? secondHalfCompletions.reduce((s, v) => s + v, 0) / secondHalfCompletions.length : 0;
  report.goalTrend = firstHalfGoal === 0 ? 0 : Math.round(((secondHalfGoal - firstHalfGoal) / firstHalfGoal) * 100);

  // ===== DIET DATA =====
  const totalWater = activities.reduce((s, a) => s + (a.diet?.waterIntake || 0), 0);
  const totalCalories = activities.reduce((s, a) => s + (a.diet?.totalCalories || 0), 0);
  const totalProtein = activities.reduce((s, a) => s + (a.diet?.nutrition?.protein || 0), 0);
  const totalCarbs = activities.reduce((s, a) => s + (a.diet?.nutrition?.carbs || 0), 0);
  const totalFats = activities.reduce((s, a) => s + (a.diet?.nutrition?.fats || 0), 0);

  const avgCount = activities.length;
  
  report.dietData = {
    calories: {
      consumed: avgCount ? Math.round(totalCalories / avgCount) : 0,
      goal: 2000
    },
    nutrition: [
      { label: 'Protein', value: avgCount ? Math.round(totalProtein / avgCount) : 0, goal: 80, unit: 'g', color: '#3b82f6' },
      { label: 'Carbs', value: avgCount ? Math.round(totalCarbs / avgCount) : 0, goal: 200, unit: 'g', color: '#f59e0b' },
      { label: 'Fats', value: avgCount ? Math.round(totalFats / avgCount) : 0, goal: 60, unit: 'g', color: '#ec4899' }
    ],
    waterIntake: {
      current: avgCount ? Math.round(totalWater / avgCount) : 0,
      goal: 8
    }
  };

  // ===== MENSTRUAL DATA =====
  const periodActivities = activities.filter(a => a.menstrualCycle?.isPeriod);
  if (periodActivities.length > 0) {
    report.menstrualData = {
      periodCount: periodActivities.length,
      lastPeriodDate: periodActivities[periodActivities.length - 1]?.date,
      symptoms: activities
        .filter(a => a.menstrualCycle?.symptoms?.length > 0)
        .flatMap(a => a.menstrualCycle.symptoms)
        .filter((v, i, a) => a.indexOf(v) === i)
    };
  }

  // ===== GENERATE INSIGHTS =====
  const insights = [];

  if (report.currentStreak >= 7)
    insights.push({
      icon: '🔥',
      text: `Amazing! You've maintained a ${report.currentStreak}-day streak. Keep it up!`,
      type: 'positive'
    });
  else if (report.currentStreak >= 3)
    insights.push({
      icon: '🎯',
      text: `You're on a ${report.currentStreak}-day streak! Just ${7 - report.currentStreak} more days to reach a week.`,
      type: 'info'
    });

  if (exercises.length > 0) {
    if (totalExerciseSessions >= 20)
      insights.push({
        icon: '💪',
        text: `You've reached your exercise goal this period!`,
        type: 'positive'
      });
  }

  if (journalCount < 5)
    insights.push({
      icon: '📝',
      text: `Try journaling more often to support your mental wellness.`,
      type: 'info'
    });

  if (report.dietData?.waterIntake?.current >= report.dietData?.waterIntake?.goal)
    insights.push({
      icon: '💧',
      text: `Great hydration! You're meeting your daily water goals.`,
      type: 'positive'
    });

  if (moodTrend > 10)
    insights.push({
      icon: '😊',
      text: `Your mood has improved by ${moodTrend}% recently.`,
      type: 'positive'
    });

  report.insights = insights;

  await report.save();
}
