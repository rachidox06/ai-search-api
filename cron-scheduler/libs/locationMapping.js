/**
 * Location Mapping Utility
 *
 * Handles location mapping for different AI search engines
 * Each engine has different location parameter requirements
 */

/**
 * Map location names to ISO country codes (ISO 3166-1 alpha-2)
 * Used by: Claude, Perplexity
 */
export function mapLocationToISO(location) {
  const localeMap = {
    'United States': 'US',
    'United Kingdom': 'GB',
    'Canada': 'CA',
    'Australia': 'AU',
    'Germany': 'DE',
    'France': 'FR',
    'Spain': 'ES',
    'Italy': 'IT',
    'Japan': 'JP',
    'China': 'CN',
    'India': 'IN',
    'Brazil': 'BR',
    'Mexico': 'MX',
    'Netherlands': 'NL',
    'Sweden': 'SE',
    'Norway': 'NO',
    'Denmark': 'DK',
    'Finland': 'FI',
    'Poland': 'PL',
    'Portugal': 'PT',
    'Austria': 'AT',
    'Belgium': 'BE',
    'Switzerland': 'CH',
    'Ireland': 'IE',
    'New Zealand': 'NZ',
    'Singapore': 'SG',
    'South Korea': 'KR',
    'Hong Kong': 'HK',
    'Taiwan': 'TW',
    'South Africa': 'ZA',
  };

  return localeMap[location] || 'US';
}

/**
 * Map location to coordinates (latitude/longitude)
 * Used by: Perplexity (required with country code), Gemini (grounding)
 *
 * Uses approximate capital city coordinates for each country
 */
export function mapLocationToCoordinates(location) {
  const coordinatesMap = {
    'United States': { latitude: 38.9072, longitude: -77.0369 }, // Washington DC
    'United Kingdom': { latitude: 51.5074, longitude: -0.1278 },  // London
    'Canada': { latitude: 45.4215, longitude: -75.6972 },         // Ottawa
    'Australia': { latitude: -35.2809, longitude: 149.1300 },     // Canberra
    'Germany': { latitude: 52.5200, longitude: 13.4050 },         // Berlin
    'France': { latitude: 48.8566, longitude: 2.3522 },           // Paris
    'Spain': { latitude: 40.4168, longitude: -3.7038 },           // Madrid
    'Italy': { latitude: 41.9028, longitude: 12.4964 },           // Rome
    'Japan': { latitude: 35.6762, longitude: 139.6503 },          // Tokyo
    'China': { latitude: 39.9042, longitude: 116.4074 },          // Beijing
    'India': { latitude: 28.6139, longitude: 77.2090 },           // New Delhi
    'Brazil': { latitude: -15.8267, longitude: -47.9218 },        // Brasília
    'Mexico': { latitude: 19.4326, longitude: -99.1332 },         // Mexico City
    'Netherlands': { latitude: 52.3676, longitude: 4.9041 },      // Amsterdam
    'Sweden': { latitude: 59.3293, longitude: 18.0686 },          // Stockholm
    'Norway': { latitude: 59.9139, longitude: 10.7522 },          // Oslo
    'Denmark': { latitude: 55.6761, longitude: 12.5683 },         // Copenhagen
    'Finland': { latitude: 60.1695, longitude: 24.9354 },         // Helsinki
    'Poland': { latitude: 52.2297, longitude: 21.0122 },          // Warsaw
    'Portugal': { latitude: 38.7223, longitude: -9.1393 },        // Lisbon
    'Austria': { latitude: 48.2082, longitude: 16.3738 },         // Vienna
    'Belgium': { latitude: 50.8503, longitude: 4.3517 },          // Brussels
    'Switzerland': { latitude: 46.9480, longitude: 7.4474 },      // Bern
    'Ireland': { latitude: 53.3498, longitude: -6.2603 },         // Dublin
    'New Zealand': { latitude: -41.2865, longitude: 174.7762 },   // Wellington
    'Singapore': { latitude: 1.3521, longitude: 103.8198 },       // Singapore
    'South Korea': { latitude: 37.5665, longitude: 126.9780 },    // Seoul
    'Hong Kong': { latitude: 22.3193, longitude: 114.1694 },      // Hong Kong
    'Taiwan': { latitude: 25.0330, longitude: 121.5654 },         // Taipei
    'South Africa': { latitude: -25.7479, longitude: 28.2293 },   // Pretoria
  };

  return coordinatesMap[location] || { latitude: 38.9072, longitude: -77.0369 }; // Default to US
}

/**
 * Map location to DataForSEO location_name format
 * Used by: ChatGPT (LLM Scraper), Google AI Mode
 *
 * DataForSEO uses specific formats like "London,England,United Kingdom"
 * For now, we'll use the location name as-is and rely on DataForSEO's API
 * to handle it. In production, you may want to fetch the exact location list
 * from DataForSEO's locations endpoint.
 */
export function mapLocationToDataForSEO(location) {
  // For most cases, DataForSEO accepts country names directly
  // You can expand this map if you need specific city-level targeting
  const dataForSEOMap = {
    'United States': 'United States',
    'United Kingdom': 'United Kingdom',
    'Canada': 'Canada',
    'Australia': 'Australia',
    'Germany': 'Germany',
    'France': 'France',
    'Spain': 'Spain',
    'Italy': 'Italy',
    'Japan': 'Japan',
    'China': 'China',
    'India': 'India',
    'Brazil': 'Brazil',
    'Mexico': 'Mexico',
    'Netherlands': 'Netherlands',
    'Sweden': 'Sweden',
    'Norway': 'Norway',
    'Denmark': 'Denmark',
    'Finland': 'Finland',
    'Poland': 'Poland',
    'Portugal': 'Portugal',
    'Austria': 'Austria',
    'Belgium': 'Belgium',
    'Switzerland': 'Switzerland',
    'Ireland': 'Ireland',
    'New Zealand': 'New Zealand',
    'Singapore': 'Singapore',
    'South Korea': 'South Korea',
    'Hong Kong': 'Hong Kong',
    'Taiwan': 'Taiwan',
    'South Africa': 'South Africa',
  };

  return dataForSEOMap[location] || 'United States';
}

/**
 * Get all supported locations
 */
export function getAllLocations() {
  return [
    'United States',
    'United Kingdom',
    'Canada',
    'Australia',
    'Germany',
    'France',
    'Spain',
    'Italy',
    'Japan',
    'China',
    'India',
    'Brazil',
    'Mexico',
    'Netherlands',
    'Sweden',
    'Norway',
    'Denmark',
    'Finland',
    'Poland',
    'Portugal',
    'Austria',
    'Belgium',
    'Switzerland',
    'Ireland',
    'New Zealand',
    'Singapore',
    'South Korea',
    'Hong Kong',
    'Taiwan',
    'South Africa',
  ];
}

/**
 * Parse tracking_config JSON to get enabled engines
 * Returns array of enabled engine names
 */
export function getEnabledEngines(trackingConfig) {
  if (!trackingConfig) {
    // Default: all engines enabled
    return ['chatgpt', 'perplexity', 'gemini', 'google', 'claude'];
  }

  try {
    const config = typeof trackingConfig === 'string'
      ? JSON.parse(trackingConfig)
      : trackingConfig;

    const enabledEngines = [];

    for (const [engine, settings] of Object.entries(config)) {
      if (settings?.enabled === true) {
        enabledEngines.push(engine.toLowerCase());
      }
    }

    // If no engines are enabled, return all engines as fallback
    return enabledEngines.length > 0
      ? enabledEngines
      : ['chatgpt', 'perplexity', 'gemini', 'google', 'claude'];
  } catch (error) {
    console.error('Error parsing tracking_config:', error);
    // Fallback: all engines
    return ['chatgpt', 'perplexity', 'gemini', 'google', 'claude'];
  }
}

/**
 * Check if a prompt should be run based on check_frequency and last_run_at
 * @param {string} checkFrequency - 'daily' or 'weekly'
 * @param {Date|string|null} lastRunAt - Last run timestamp
 * @returns {boolean} - true if prompt should run
 */
export function shouldRunPrompt(checkFrequency, lastRunAt) {
  // If never run before, always run
  if (!lastRunAt) {
    return true;
  }

  const now = new Date();
  const lastRun = new Date(lastRunAt);
  const daysSinceLastRun = (now - lastRun) / (1000 * 60 * 60 * 24);

  if (checkFrequency === 'daily') {
    // Run if more than 1 day has passed
    return daysSinceLastRun >= 1;
  } else if (checkFrequency === 'weekly') {
    // Run if more than 7 days have passed
    return daysSinceLastRun >= 7;
  }

  // Default: don't run if unknown frequency
  return false;
}
