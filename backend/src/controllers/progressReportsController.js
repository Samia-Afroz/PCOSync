import ProgressReport from '../models/ProgressReport.js';
import UserActivity from '../models/UserActivity.js';
import PeriodLog from '../models/PeriodLog.js';
import { calculateCycleStats } from '../services/cycleStatsService.js';
import PDFDocument from 'pdfkit';

// =========================
// HELPER FUNCTIONS
// =========================

// Get date range
const getDateRange = (timeRange) => {
  const endDate = new Date();
  const startDate = new Date();

  switch (timeRange) {
    case '7':
      startDate.setDate(endDate.getDate() - 7);
      break;
    case '30':
      startDate.setDate(endDate.getDate() - 30);
      break;
    case '90':
      startDate.setDate(endDate.getDate() - 90);
      break;
    case '365':
      startDate.setDate(endDate.getDate() - 365);
      break;
    default:
      startDate.setDate(endDate.getDate() - 30);
  }

  return { startDate, endDate };
};

// Calculate streak from daily check-ins
const calculateStreak = async (userId, endDate) => {
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let lastDate = null;

  const activities = await UserActivity.find({
    userId,
    date: { $lte: endDate },
    streakDay: true
  }).sort({ date: -1 });

  for (const activity of activities) {
    const activityDate = new Date(activity.date);

    if (!lastDate) {
      tempStreak = currentStreak = longestStreak = 1;
    } else {
      const dayDiff = Math.floor((lastDate - activityDate) / (1000 * 60 * 60 * 24));

      if (dayDiff === 1) {
        tempStreak++;
        currentStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else if (dayDiff > 1) {
        currentStreak = 0;
        tempStreak = 1;
        longestStreak = Math.max(longestStreak, tempStreak);
      }
    }

    lastDate = activityDate;
  }

  if (lastDate && activities.length > 0) {
    const daysSinceLastActivity = Math.floor((endDate - lastDate) / (1000 * 60 * 60 * 24));
    if (daysSinceLastActivity > 1) currentStreak = 0;
  }

  return {
    currentStreak: currentStreak || 0,
    longestStreak: longestStreak || 0
  };
};

// Calculate mood data
const calculateMoodData = async (userId, startDate, endDate) => {
  const activities = await UserActivity.find({
    userId,
    date: { $gte: startDate, $lte: endDate },
    'mood.rating': { $exists: true }
  }).sort({ date: 1 });

  if (!activities.length) {
    return {
      averageMood: '😐',
      moodData: { weekly: [] },
      journalCount: 0,
      moodTrend: 0
    };
  }

  const weeklyMood = {};
  let totalMood = 0;
  let moodCount = 0;
  let journalCount = 0;

  activities.forEach((activity, index) => {
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

  return {
    averageMood: moodEmojis[avgMoodRating - 1] || '😐',
    moodData: { weekly },
    journalCount,
    moodTrend
  };
};

// Exercise data
const calculateExerciseData = async (userId, startDate, endDate) => {
  const activities = await UserActivity.find({
    userId,
    date: { $gte: startDate, $lte: endDate },
    'exercise.completed': true
  });

  if (!activities.length) {
    return {
      exercises: [],
      goal: 20,
      weeklyGoal: 5
    };
  }

  const exerciseTypes = {};
  activities.forEach((activity) => {
    const type = activity.exercise.type || 'other';
    exerciseTypes[type] = (exerciseTypes[type] || 0) + 1;
  });

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

  const exercises = Object.keys(exerciseTypes).map((type) => ({
    name: type.charAt(0).toUpperCase() + type.slice(1),
    sessions: exerciseTypes[type],
    icon: exerciseIcons[type] || '🏋️',
    color: exerciseColors[type] || '#6b7280'
  }));

  return {
    exercises,
    goal: 20,
    weeklyGoal: 5
  };
};

// Diet data
const calculateDietData = async (userId, startDate, endDate) => {
  const activities = await UserActivity.find({
    userId,
    date: { $gte: startDate, $lte: endDate },
    'diet.totalCalories': { $exists: true }
  });

  if (!activities.length) {
    return {
      calories: { consumed: 0, goal: 2000 },
      nutrition: [
        { label: 'Protein', value: 0, goal: 80, unit: 'g', color: '#3b82f6' },
        { label: 'Carbs', value: 0, goal: 200, unit: 'g', color: '#f59e0b' },
        { label: 'Fats', value: 0, goal: 60, unit: 'g', color: '#ec4899' }
      ],
      waterIntake: { current: 0, goal: 8 }
    };
  }
  let totalCalories = 0, totalProtein = 0, totalCarbs = 0, totalFats = 0, totalWater = 0, count = 0;

  activities.forEach((activity) => {
    if (activity.diet) {
      totalCalories += activity.diet.totalCalories || 0;
      totalProtein += activity.diet.nutrition?.protein || 0;
      totalCarbs += activity.diet.nutrition?.carbs || 0;
      totalFats += activity.diet.nutrition?.fats || 0;
      totalWater += activity.diet.waterIntake || 0;
      count++;
    }
  });

  if (count === 0) {
    return {
      calories: { consumed: 0, goal: 2000 },
      nutrition: [
        { label: 'Protein', value: 0, goal: 80, unit: 'g', color: '#3b82f6' },
        { label: 'Carbs', value: 0, goal: 200, unit: 'g', color: '#f59e0b' },
        { label: 'Fats', value: 0, goal: 60, unit: 'g', color: '#ec4899' }
      ],
      waterIntake: { current: 0, goal: 8 }
    };
  }

  return {
    calories: {
      consumed: count ? Math.round(totalCalories / count) : 0,
      goal: 2000
    },
    nutrition: [
      { label: 'Protein', value: Math.round(totalProtein / count), goal: 80, unit: 'g', color: '#3b82f6' },
      { label: 'Carbs', value: Math.round(totalCarbs / count), goal: 200, unit: 'g', color: '#f59e0b' },
      { label: 'Fats', value: Math.round(totalFats / count), goal: 60, unit: 'g', color: '#ec4899' }
    ],
    waterIntake: { current: Math.round(totalWater / count), goal: 8 }
  };
};

// Calculate menstrual data
const calculateMenstrualData = async (userId) => {
  try {
    const logs = await PeriodLog.find({ userId }).sort({ date: -1 });
    if (!logs.length) {
      return {
        currentDay: 1,
        cycleLength: 28,
        nextPeriod: 'Not available',
        dateRange: 'No data',
        avgCycle: '28',
        periodLength: '5-7',
        regularity: 'N/A'
      };
    }

    const stats = calculateCycleStats(logs);
    const sortedLogs = logs.sort((a, b) => new Date(b.date) - new Date(a.date)); // Most recent first
    const lastPeriodDate = new Date(sortedLogs[0].date);
    const today = new Date();
    const daysSinceLastPeriod = Math.floor((today - lastPeriodDate) / (1000 * 60 * 60 * 24));

    let currentDay = daysSinceLastPeriod + 1;
    const cycleLength = stats.averageLength || 28;

    // If currentDay > cycleLength, it's a new cycle
    if (currentDay > cycleLength) {
      currentDay = currentDay % cycleLength || cycleLength;
    }

    // Next period date
    const nextPeriodDate = new Date(lastPeriodDate);
    nextPeriodDate.setDate(nextPeriodDate.getDate() + cycleLength);
    const nextPeriodStr = nextPeriodDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Date range for last period: find start and end of last period
    let lastPeriodStart = lastPeriodDate;
    let lastPeriodEnd = lastPeriodDate;
    const logDates = new Set(sortedLogs.map(log => log.date));
    let checkDate = new Date(lastPeriodDate);
    // Go backwards to find start
    while (true) {
      checkDate.setDate(checkDate.getDate() - 1);
      const dateStr = checkDate.toISOString().split('T')[0];
      if (logDates.has(dateStr)) {
        lastPeriodStart = new Date(checkDate);
      } else {
        break;
      }
    }
    // Go forwards to find end
    checkDate = new Date(lastPeriodDate);
    while (true) {
      checkDate.setDate(checkDate.getDate() + 1);
      const dateStr = checkDate.toISOString().split('T')[0];
      if (logDates.has(dateStr)) {
        lastPeriodEnd = new Date(checkDate);
      } else {
        break;
      }
    }
    const dateRange = `${lastPeriodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${lastPeriodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    // Average cycle
    const avgCycle = stats.averageLength ? `${stats.averageLength}` : '28';

    // Period length: calculate average period duration
    const periodLengths = [];
    let currentPeriodStart = null;
    const sortedAsc = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const log of sortedAsc) {
      if (!currentPeriodStart) {
        currentPeriodStart = new Date(log.date);
      } else {
        const diff = Math.floor((new Date(log.date) - currentPeriodStart) / (1000 * 60 * 60 * 24));
        if (diff > 1) { // Gap indicates end of period
          periodLengths.push(Math.floor((new Date(log.date) - currentPeriodStart) / (1000 * 60 * 60 * 24)));
          currentPeriodStart = new Date(log.date);
        }
      }
    }
    const avgPeriodLength = periodLengths.length ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length) : 5;
    const periodLength = `${avgPeriodLength}-${avgPeriodLength + 2}`;

    // Regularity
    const regularity = stats.variability !== null ? Math.max(0, 100 - stats.variability * 2) : 85;

    return {
      currentDay,
      cycleLength,
      nextPeriod: nextPeriodStr,
      dateRange,
      avgCycle,
      periodLength,
      regularity: `${regularity}%`
    };
  } catch (error) {
    console.error('Error calculating menstrual data:', error);
    return {
      currentDay: 1,
      cycleLength: 28,
      nextPeriod: 'Not available',
      dateRange: 'No data',
      avgCycle: '28',
      periodLength: '5-7',
      regularity: 'N/A'
    };
  }
};

// Generate insights
const generateInsights = (reportData) => {
  const insights = [];

  if (reportData.currentStreak >= 7)
    insights.push({
      icon: '🔥',
      text: `Amazing! You've maintained a ${reportData.currentStreak}-day streak. Keep it up!`,
      type: 'positive'
    });
  else if (reportData.currentStreak >= 3)
    insights.push({
      icon: '🎯',
      text: `You're on a ${reportData.currentStreak}-day streak! Just ${7 - reportData.currentStreak} more days to reach a week.`,
      type: 'info'
    });

  if (reportData.exerciseData?.exercises?.length) {
    const totalSessions = reportData.exerciseData.exercises.reduce((sum, ex) => sum + ex.sessions, 0);
    const goalPercentage = (totalSessions / (reportData.exerciseData.goal || 20)) * 100;

    if (goalPercentage >= 100)
      insights.push({
        icon: '💪',
        text: `You've reached your exercise goal this period!`,
        type: 'positive'
      });
  }

  if (reportData.journalCount < 5)
    insights.push({
      icon: '📝',
      text: `Try journaling more often to support your mental wellness.`,
      type: 'info'
    });

  if (reportData.dietData?.waterIntake?.current >= reportData.dietData?.waterIntake?.goal)
    insights.push({
      icon: '💧',
      text: `Great hydration! You're meeting your daily water goals.`,
      type: 'positive'
    });

  if (reportData.moodTrend > 10)
    insights.push({
      icon: '😊',
      text: `Your mood has improved by ${reportData.moodTrend}% recently.`,
      type: 'positive'
    });

  return insights;
};

// =========================
// CONTROLLERS
// =========================

export const getProgressReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeRange = '30' } = req.query;
    const { startDate, endDate } = getDateRange(timeRange);

    // Always compute fresh metrics so updates to daily check‑ins show immediately
    const streakData = await calculateStreak(userId, endDate);
    const moodData = await calculateMoodData(userId, startDate, endDate);
    const exerciseData = await calculateExerciseData(userId, startDate, endDate);
    const dietData = await calculateDietData(userId, startDate, endDate);
    const menstrualData = await calculateMenstrualData(userId);

    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const activeDays = await UserActivity.countDocuments({
      userId,
      date: { $gte: startDate, $lte: endDate },
      streakDay: true
    });

    const goalProgress = Math.round((activeDays / totalDays) * 100);

    const reportData = {
      ...streakData,
      ...moodData,
      exerciseData,
      dietData,
      menstrualData,
      goalProgress,
      goalTrend: calculateGlobalTrend(streakData.currentStreak, streakData.longestStreak),
      streakTrend: calculateStreakTrend(streakData)
    };

    // 🚨 SANITIZE INSIGHTS to prevent CastError
    reportData.insights = (generateInsights(reportData) || []).map(item =>
      typeof item === 'string'
        ? { icon: 'ℹ️', text: item, type: 'info' }
        : {
            icon: item.icon || 'ℹ️',
            text: item.text || '',
            type: item.type || 'info'
          }
    );

    // Keep stored report for potential export/analytics, but response is freshly computed
    await ProgressReport.findOneAndUpdate(
      { userId, startDate, endDate },
      { $set: { userId, startDate, endDate, ...reportData } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Progress report generated',
      data: reportData
    });
  } catch (error) {
    console.error('Error generating progress report:', error);
    res.status(500).json({
      message: 'Error generating progress report',
      error: error.message
    });
  }
};

// Helper: Calculate goal trend based on streak performance
const calculateStreakTrend = (streakData) => {
  if (!streakData.longestStreak || streakData.longestStreak === 0) return 0;
  const trendPercent = (streakData.currentStreak / streakData.longestStreak) * 100;
  return Math.round(trendPercent);
};

// Helper: Calculate overall health trend
const calculateGlobalTrend = (current, longest) => {
  if (!longest || longest === 0) return 0;
  return Math.round((current / longest) * 100);
};

export const exportReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeRange = '30' } = req.query;
    const { startDate, endDate } = getDateRange(timeRange);

    // Get fresh report data
    const streakData = await calculateStreak(userId, endDate);
    const moodData = await calculateMoodData(userId, startDate, endDate);
    const exerciseData = await calculateExerciseData(userId, startDate, endDate);
    const dietData = await calculateDietData(userId, startDate, endDate);
    const menstrualData = await calculateMenstrualData(userId);

    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const activeDays = await UserActivity.countDocuments({
      userId,
      date: { $gte: startDate, $lte: endDate },
      streakDay: true
    });

    const goalProgress = Math.round((activeDays / totalDays) * 100);

    const reportData = {
      ...streakData,
      ...moodData,
      exerciseData,
      dietData,
      menstrualData,
      goalProgress,
      goalTrend: calculateGlobalTrend(streakData.currentStreak, streakData.longestStreak),
      streakTrend: calculateStreakTrend(streakData)
    };

    reportData.insights = (generateInsights(reportData) || []).map(item =>
      typeof item === 'string'
        ? { icon: 'ℹ️', text: item, type: 'info' }
        : {
            icon: item.icon || 'ℹ️',
            text: item.text || '',
            type: item.type || 'info'
          }
    );

    // Generate PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50
    });

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="progress-report-${Date.now()}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('PCOS Progress Report', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`, { align: 'center' });
    doc.moveDown();

    // Summary Section
    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(11).font('Helvetica');
    doc.text(`Current Streak: ${streakData.currentStreak} days`);
    doc.text(`Longest Streak: ${streakData.longestStreak} days`);
    doc.text(`Goal Progress: ${goalProgress}%`);
    doc.moveDown();

    // Menstrual Data Section
    doc.fontSize(14).font('Helvetica-Bold').text('Menstrual Cycle');
    doc.fontSize(11).font('Helvetica');
    doc.text(`Current Cycle Day: ${menstrualData.currentDay}`);
    doc.text(`Average Cycle Length: ${menstrualData.avgCycle} days`);
    doc.text(`Estimated Next Period: ${menstrualData.nextPeriod}`);
    doc.text(`Period Regularity: ${menstrualData.regularity}`);
    doc.moveDown();

    // Mood Data Section
    if (moodData) {
      doc.fontSize(14).font('Helvetica-Bold').text('Mood Tracking');
      doc.fontSize(11).font('Helvetica');
      doc.text(`Average Mood: ${moodData.averageMood}`);
      doc.text(`Journal Entries: ${moodData.journalCount}`);
      doc.text(`Mood Trend: ${moodData.moodTrend > 0 ? '+' : ''}${moodData.moodTrend}%`);
      doc.moveDown();
    }

    // Exercise Data Section
    if (exerciseData && exerciseData.exercises.length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('Exercise Activity');
      doc.fontSize(11).font('Helvetica');
      exerciseData.exercises.forEach(ex => {
        doc.text(`${ex.icon} ${ex.name}: ${ex.sessions} sessions`);
      });
      doc.moveDown();
    }

    // Diet Data Section
    if (dietData) {
      doc.fontSize(14).font('Helvetica-Bold').text('Nutrition & Hydration');
      doc.fontSize(11).font('Helvetica');
      doc.text(`Average Daily Calories: ${dietData.calories.consumed} / ${dietData.calories.goal}`);
      if (dietData.nutrition) {
        dietData.nutrition.forEach(nutrient => {
          doc.text(`${nutrient.label}: ${nutrient.value}${nutrient.unit} / ${nutrient.goal}${nutrient.unit}`);
        });
      }
      doc.text(`Water Intake: ${dietData.waterIntake.current} / ${dietData.waterIntake.goal} glasses`);
      doc.moveDown();
    }

    // Insights Section
    if (reportData.insights && reportData.insights.length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('Insights & Recommendations');
      doc.fontSize(11).font('Helvetica');
      reportData.insights.forEach(insight => {
        doc.text(`${insight.icon} ${insight.text}`);
      });
      doc.moveDown();
    }

    // Footer
    doc.fontSize(9).font('Helvetica').text('Generated by PCOS Sync', { align: 'center' });
    doc.text(`Generated on ${new Date().toLocaleString()}`, { align: 'center' });

    // End document
    doc.end();
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({
      message: 'Error exporting report',
      error: error.message
    });
  }
};

export const getMetricData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { metricType } = req.params;
    const { timeRange = '30' } = req.query;

    const { startDate, endDate } = getDateRange(timeRange);
    let data;

    switch (metricType) {
      case 'mood':
        data = await calculateMoodData(userId, startDate, endDate);
        break;
      case 'exercise':
        data = await calculateExerciseData(userId, startDate, endDate);
        break;
      case 'diet':
        data = await calculateDietData(userId, startDate, endDate);
        break;
      default:
        return res.status(400).json({ message: 'Invalid metric type' });
    }

    res.json(data);
  } catch (error) {
    console.error(`Error fetching ${req.params.metricType} data:`, error);
    res.status(500).json({
      message: 'Error fetching metric data',
      error: error.message
    });
  }
};
