import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import config from '../config/apikeys.js';


/**
 * Call AiPhotocraft Virtual Try-On API
 * @param {string} userPhotoPath - Path to user's photo file
 * @param {string} outfitPhotoPath - Path to outfit photo file
 * @returns {Promise<Object>} API response with result image URL
 */
export const callVirtualTryOnAPI = async (userPhotoPath, outfitPhotoPath) => {
  try {
    console.log('🔄 Calling AiPhotocraft API...');
    console.log('📸 User Photo Path:', userPhotoPath);
    console.log('👔 Outfit Photo Path:', outfitPhotoPath);

    // Create form data according to AiPhotocraft docs
    const formData = new FormData();

    // Field names per provider: personImage and productImage
    formData.append('personImage', fs.createReadStream(userPhotoPath));
    formData.append('productImage', fs.createReadStream(outfitPhotoPath));

    // ========================================================
    // ⚠️ THIS IS WHERE THE API KEY IS USED ⚠️
    // ========================================================
    // determine endpoint and key, prefer env vars but fall back to config file
    const apiUrl = process.env.AIPHOTOCRAFT_API_URL || process.env.AIPHOTOVR_URL || config.AIPHOTOCRAFT_API_URL || config.AIPHOTOVR_URL;
    const apiKey = process.env.AIPHOTOVR_KEY || process.env.AIPHOTOCRAFT_API_KEY || config.AIPHOTOVR_KEY || config.AIPHOTOCRAFT_API_KEY;

    if (!apiUrl) {
      console.error('Missing virtual try-on API URL (AIPHOTOCRAFT_API_URL)');
      return {
        success: false,
        error: 'Missing virtual try-on API URL (AIPHOTOCRAFT_API_URL)',
        statusCode: 500,
      };
    }

    // warn if the URL is still the example placeholder – that will never work
    if (apiUrl.includes('aiphotocraft.example')) {
      console.error('Virtual try-on API URL is still the placeholder value');
      return {
        success: false,
        error: 'Virtual try-on API URL is not configured (placeholder found). Please set AIPHOTOCRAFT_API_URL or use mock mode.',
        statusCode: 500,
      };
    }

    console.log('🔗 Using virtual try-on API URL:', apiUrl);

    if (!apiKey) {
      console.warn('⚠️ No API key provided for virtual try-on; requests may fail. Set AIPHOTOVR_KEY or AIPHOTOCRAFT_API_KEY in env.');
      // we don't abort; API may accept unauthenticated requests
    } else if (apiKey === '02eb60c8b7a1d2f902f7d7cf5333f1fa5dbd6ce153e1ef1c5b28b6c2a96d3dad') {
      // example key provided in config; probably not valid
      console.warn('⚠️ Using the default example API key. Replace with your real key in env or config.');
    }

    // POST to the virtual try-on path. If `apiUrl` already contains the /api
    // prefix (as in the provider example https://taiapi.aiphotocraft.com/api)
    // we append the endpoint path without duplicating slashes.
    const apiBase = apiUrl.replace(/\/$/, '');
    const postUrl = `${apiBase}/virtual_try_on`;

    const response = await axios.post(
      postUrl,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          // Provider expects X-Api-Key header
          'X-Api-Key': apiKey,
          accept: 'application/json',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000, // 2 minutes timeout for initial job submission
      }
    );

    console.log('✅ AiPhotocraft API Response Received');
    console.log('📊 Response Status:', response.status);
    console.log('📦 Response Data:', JSON.stringify(response.data, null, 2));

    // Provider returns a task id for async processing
    const taskId = response.data.task_id || response.data.id || response.data.job_id;

    if (!taskId) {
      // Some providers might return an immediate image_url; handle that as well
      const immediateImage = response.data.image_url || response.data.result_url || response.data.output_url;
      if (immediateImage) {
        return {
          success: true,
          data: response.data,
          resultImageUrl: immediateImage,
          requestId: null,
          processingTime: response.data.processing_time || 0,
        };
      }

      console.error('❌ No task_id or immediate image returned from API');
      return {
        success: false,
        error: 'API did not return a task id or result image',
        statusCode: 500,
        details: response.data,
      };
    }

    // Poll task status until image is ready or timeout
    const statusUrl = `${apiBase}/task-status/${taskId}`;
    const pollInterval = 2000; // 2 seconds
    const timeoutMs = 120000; // 2 minutes total
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const statusResp = await axios.get(statusUrl, {
          headers: { 'X-Api-Key': apiKey, accept: 'application/json' },
          timeout: 30000,
        });

        // provider example returns { image_url: 'https://...' } when done
        const imageUrl = statusResp.data.image_url || statusResp.data.result_url || statusResp.data.output_url;
        if (imageUrl) {
          return {
            success: true,
            data: statusResp.data,
            resultImageUrl: imageUrl,
            requestId: taskId,
            processingTime: Date.now() - start,
          };
        }

        // if not ready, wait and continue polling
        await new Promise((r) => setTimeout(r, pollInterval));
      } catch (pollErr) {
        console.warn('⚠️ Task status poll error:', pollErr.response?.data || pollErr.message);
        // continue polling unless fatal
        await new Promise((r) => setTimeout(r, pollInterval));
      }
    }

    return {
      success: false,
      error: 'Timed out while waiting for virtual try-on to complete',
      statusCode: 504,
    };
  } catch (error) {
    console.error('❌ AiPhotocraft API Error:', error.response?.data || error.message);

    // Handle different error scenarios
    if (error.response) {
      const { status, data } = error.response;

      // 401 - Unauthorized (Invalid API Key)
      if (status === 401) {
        return {
          success: false,
          error: 'Invalid API key. Please check AIPHOTOCRAFT_API_KEY in your .env file',
          statusCode: 401,
          details: data,
        };
      }

      // 403 - Forbidden (No permission)
      if (status === 403) {
        return {
          success: false,
          error: 'API key does not have permission for this operation',
          statusCode: 403,
          details: data,
        };
      }

      // 429 - Rate Limit Exceeded
      if (status === 429) {
        return {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          statusCode: 429,
          details: data,
        };
      }

      // 400 - Bad Request
      if (status === 400) {
        return {
          success: false,
          error: data.message || 'Invalid request parameters',
          statusCode: 400,
          details: data,
        };
      }

      // Other API errors
      return {
        success: false,
        error: data.message || data.error || 'API request failed',
        statusCode: status,
        details: data,
      };
    }

    // Network errors
    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        error: 'Cannot connect to AiPhotocraft API. Please check the API URL in .env',
        statusCode: 503,
      };
    }

    if (error.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: 'API request timed out. The server took too long to respond.',
        statusCode: 504,
      };
    }

    if (error.code === 'ENOTFOUND' || error.response?.status === 404) {
      const msg = `API endpoint not found${apiUrl ? ` (${apiUrl})` : ''}. Please verify AIPHOTOCRAFT_API_URL in .env`;
      return {
        success: false,
        error: msg,
        statusCode: 404,
      };
    }

    // Generic error
    return {
      success: false,
      error: error.message || 'Failed to process virtual try-on',
      statusCode: 500,
    };
  }
};

/**
 * Check processing status (if API supports async processing)
 * @param {string} requestId - Request ID from initial API call
 * @returns {Promise<Object>} Status response
 */
export const checkTryOnStatus = async (requestId) => {
  try {
    console.log('🔄 Checking try-on status for request:', requestId);
    const apiUrl = process.env.AIPHOTOCRAFT_API_URL || process.env.AIPHOTOVR_URL || config.AIPHOTOCRAFT_API_URL || config.AIPHOTOVR_URL;
    const apiKey = process.env.AIPHOTOVR_KEY || process.env.AIPHOTOCRAFT_API_KEY || config.AIPHOTOVR_KEY || config.AIPHOTOCRAFT_API_KEY;
    const apiBase = apiUrl.replace(/\/$/, '');
    const statusUrl = `${apiBase}/task-status/${requestId}`;

    const response = await axios.get(statusUrl, {
      headers: {
        'X-Api-Key': apiKey,
        accept: 'application/json',
      },
      timeout: 30000, // 30 seconds
    });

    return {
      success: true,
      status: response.data.status || 'unknown',
      resultUrl: response.data.image_url || response.data.result_url || null,
      progress: response.data.progress || 0,
      message: response.data.message || '',
    };
  } catch (error) {
    console.error('❌ Status check error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      statusCode: error.response?.status || 500,
    };
  }
};

/**
 * Download result image from URL (if needed)
 * @param {string} imageUrl - URL of the result image
 * @param {string} savePath - Local path to save the image
 * @returns {Promise<string>} Path to saved image
 */
export const downloadResultImage = async (imageUrl, savePath) => {
  try {
    console.log('📥 Downloading result image from:', imageUrl);

    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000, // 1 minute
    });

    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Image downloaded successfully to:', savePath);
        resolve(savePath);
      });
      writer.on('error', (error) => {
        console.error('❌ Download error:', error);
        reject(error);
      });
    });
  } catch (error) {
    console.error('❌ Failed to download image:', error.message);
    throw error;
  }
};

export default {
  callVirtualTryOnAPI,
  checkTryOnStatus,
  downloadResultImage,
};