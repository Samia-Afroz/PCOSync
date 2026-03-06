import VirtualTryOn from '../models/VirtualTryOn.js';
import { callVirtualTryOnAPI, downloadResultImage } from '../utils/apiHelper.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * @desc    Generate virtual try-on
 * @route   POST /api/virtual-tryon
 * @access  Private
 */
export const generateTryOn = async (req, res) => {
  const startTime = Date.now();

  try {
    // Basic validation
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to generate try-on',
      });
    }

    if (!req.files?.userPhoto || !req.files?.outfitPhoto) {
      return res.status(400).json({
        success: false,
        message: 'Both user photo and outfit photo are required',
      });
    }

    const userPhoto = req.files.userPhoto[0];
    const outfitPhoto = req.files.outfitPhoto[0];

    console.log('📸 Processing virtual try-on request...');
    console.log('👤 User ID:', req.userId);
    console.log('📷 User Photo:', userPhoto.filename);
    console.log('👔 Outfit Photo:', outfitPhoto.filename);

    // Determine whether to use a mock response (development/testing) or call the real API.
    const useMock = process.env.USE_MOCK_VTON === 'true';
    let apiResponse;

    if (useMock) {
      console.log('🧪 Using mock virtual try-on response');
      apiResponse = {
        success: true,
        resultImageUrl: `/uploads/user-photos/${userPhoto.filename}`, // mirror user photo
        requestId: `mock-${Date.now()}`,
        data: { mock: true },
        processingTime: 1000,
      };
    } else {
      // Call the virtual try-on API (AiPhotocraft or similar)
      apiResponse = await callVirtualTryOnAPI(
        userPhoto.path,
        outfitPhoto.path
      );

      // If the external API failed, clean up and return error
      if (!apiResponse.success) {
        // Clean up uploaded files on error
        await fs.unlink(userPhoto.path).catch(() => {});
        await fs.unlink(outfitPhoto.path).catch(() => {});

        return res.status(apiResponse.statusCode || 500).json({
          success: false,
          message: apiResponse.error || 'Failed to generate virtual try-on',
          details: apiResponse.details,
        });
      }
    }

    // the service may return a remote URL – download it so we can serve it locally
    let resultImageUrl = apiResponse.resultImageUrl;
    if (resultImageUrl && resultImageUrl.startsWith('http')) {
      try {
        // ensure results directory exists
        const RESULTS_DIR = path.join(__dirname, '../../uploads/results');
        await fs.mkdir(RESULTS_DIR, { recursive: true });

        const ext = path.extname(resultImageUrl).split('?')[0] || '.jpg';
        const resultFilename = `result-${Date.now()}${ext}`;
        const savePath = path.join(RESULTS_DIR, resultFilename);

        // downloadResultImage was added to imports above
        await downloadResultImage(resultImageUrl, savePath);
        resultImageUrl = `/uploads/results/${resultFilename}`;
      } catch (downloadErr) {
        console.error('⚠️ failed to download remote result image, falling back to remote url', downloadErr.message);
        // keep remote URL if download fails
      }
    }

    // if the API already returned a local path (for example development), just use it

    const processingTime = Date.now() - startTime;

    // ensure the API gave us something sensible
    if (!resultImageUrl) {
      console.error('❌ No resultImageUrl after API call', apiResponse);
      return res.status(500).json({
        success: false,
        message: 'Virtual try-on API did not return a result image',
      });
    }

    // Save to database
    const tryOn = new VirtualTryOn({
      userId: req.userId,
      userPhotoUrl: `/uploads/user-photos/${userPhoto.filename}`,
      outfitPhotoUrl: `/uploads/outfits/${outfitPhoto.filename}`,
      resultPhotoUrl: resultImageUrl,
      apiRequestId: apiResponse.requestId,
      processingStatus: 'completed',
      notes: req.body.notes || '',
      tags: req.body.tags
        ? req.body.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [],
      metadata: {
        processingTime,
        apiResponse: apiResponse.data,
      },
    });

    await tryOn.save();

    console.log('✅ Virtual try-on generated successfully:', tryOn._id);

    res.status(201).json({
      success: true,
      message: 'Virtual try-on generated successfully',
      data: tryOn,
      processingTime: `${processingTime}ms`,
    });
  } catch (error) {
    // log full stack to aid debugging
    console.error('❌ Generate try-on error:', error.stack || error);

    // Clean up files on error
    if (req.files?.userPhoto?.[0]?.path) {
      await fs.unlink(req.files.userPhoto[0].path).catch(() => {});
    }
    if (req.files?.outfitPhoto?.[0]?.path) {
      await fs.unlink(req.files.outfitPhoto[0].path).catch(() => {});
    }

    // send back message and (in dev) stack
    const resp = {
      success: false,
      message: error.message || 'Server error while generating try-on',
    };
    if (process.env.NODE_ENV === 'development') {
      resp.error = error.stack;
    }

    res.status(500).json(resp);
  }
};

/**
 * @desc    Get all try-ons for current user
 * @route   GET /api/virtual-tryon
 * @access  Private
 */
export const getUserTryOns = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      isFavorite,
      search,
      sortBy = 'createdAt',
    } = req.query;

    // Build filter
    const filter = { userId: req.userId };

    if (isFavorite !== undefined) {
      filter.isFavorite = isFavorite === 'true';
    }

    if (search) {
      filter.$or = [
        { notes: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    // Build sort
    const sortOptions = {};
    sortOptions[sortBy] = -1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tryOns, total] = await Promise.all([
      VirtualTryOn.find(filter)
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip)
        .lean()
        .exec(),
      VirtualTryOn.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tryOns,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasMore: skip + tryOns.length < total,
      },
    });
  } catch (error) {
    console.error('❌ Get try-ons error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching try-ons',
      error: error.message,
    });
  }
};

/**
 * @desc    Get single try-on by ID
 * @route   GET /api/virtual-tryon/:id
 * @access  Private
 */
export const getTryOnById = async (req, res) => {
  try {
    const tryOn = await VirtualTryOn.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!tryOn) {
      return res.status(404).json({
        success: false,
        message: 'Try-on not found',
      });
    }

    res.json({
      success: true,
      data: tryOn,
    });
  } catch (error) {
    console.error('❌ Get try-on error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching try-on',
      error: error.message,
    });
  }
};

/**
 * @desc    Toggle favorite status
 * @route   PATCH /api/virtual-tryon/:id/favorite
 * @access  Private
 */
export const toggleFavorite = async (req, res) => {
  try {
    const tryOn = await VirtualTryOn.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!tryOn) {
      return res.status(404).json({
        success: false,
        message: 'Try-on not found',
      });
    }

    await tryOn.toggleFavorite();

    res.json({
      success: true,
      message: `Try-on ${tryOn.isFavorite ? 'added to' : 'removed from'} favorites`,
      data: tryOn,
    });
  } catch (error) {
    console.error('❌ Toggle favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating favorite',
      error: error.message,
    });
  }
};

/**
 * @desc    Update try-on notes and tags
 * @route   PUT /api/virtual-tryon/:id
 * @access  Private
 */
export const updateTryOn = async (req, res) => {
  try {
    const { notes, tags } = req.body;

    const tryOn = await VirtualTryOn.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!tryOn) {
      return res.status(404).json({
        success: false,
        message: 'Try-on not found',
      });
    }

    if (notes !== undefined) tryOn.notes = notes;
    if (tags !== undefined) {
      tryOn.tags =
        typeof tags === 'string'
          ? tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : Array.isArray(tags)
          ? tags
          : [];
    }

    await tryOn.save();

    res.json({
      success: true,
      message: 'Try-on updated successfully',
      data: tryOn,
    });
  } catch (error) {
    console.error('❌ Update try-on error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating try-on',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete try-on
 * @route   DELETE /api/virtual-tryon/:id
 * @access  Private
 */
export const deleteTryOn = async (req, res) => {
  try {
    const tryOn = await VirtualTryOn.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!tryOn) {
      return res.status(404).json({
        success: false,
        message: 'Try-on not found',
      });
    }

    // Delete associated files
    try {
      const userPhotoPath = path.join(process.cwd(), tryOn.userPhotoUrl);
      const outfitPhotoPath = path.join(process.cwd(), tryOn.outfitPhotoUrl);

      await Promise.all([
        fs.unlink(userPhotoPath).catch(() => {}),
        fs.unlink(outfitPhotoPath).catch(() => {}),
      ]);
    } catch (fileError) {
      console.error('Error deleting files:', fileError);
    }

    await tryOn.deleteOne();

    res.json({
      success: true,
      message: 'Try-on deleted successfully',
    });
  } catch (error) {
    console.error('❌ Delete try-on error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting try-on',
      error: error.message,
    });
  }
};

/**
 * @desc    Get user statistics
 * @route   GET /api/virtual-tryon/stats
 * @access  Private
 */
export const getUserStats = async (req, res) => {
  try {
    const stats = await VirtualTryOn.aggregate([
      { $match: { userId: req.user._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          favorites: {
            $sum: { $cond: ['$isFavorite', 1, 0] },
          },
        },
      },
    ]);

    const result = stats[0] || { total: 0, favorites: 0 };

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('❌ Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching statistics',
      error: error.message,
    });
  }
};

export default {
  generateTryOn,
  getUserTryOns,
  getTryOnById,
  toggleFavorite,
  updateTryOn,
  deleteTryOn,
  getUserStats,
};