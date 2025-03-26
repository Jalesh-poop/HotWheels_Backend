import { type SearchParams, type Listing, type MarketValue, type ListingsResponse } from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";

// Environment variable for the eBay API key
const EBAY_API_KEY = process.env.EBAY_API_KEY || "";

// Helper function to format API URL with search parameters
function formatSearchUrl(params: SearchParams): string {
  const { query, condition, minPrice, maxPrice, sort, page } = params;
  
  // Base URL for eBay's Finding API
  let url = "https://svcs.ebay.com/services/search/FindingService/v1";
  
  // Add required parameters
  url += "?OPERATION-NAME=findCompletedItems";
  url += "&SERVICE-VERSION=1.0.0";
  url += "&SECURITY-APPNAME=" + EBAY_API_KEY;
  url += "&RESPONSE-DATA-FORMAT=JSON";
  url += "&REST-PAYLOAD";
  
  // Add search parameters
  url += "&keywords=" + encodeURIComponent(query);
  url += "&categoryId=222"; // Hot Wheels category
  
  // Filter to only include sold items
  url += "&itemFilter(0).name=SoldItemsOnly";
  url += "&itemFilter(0).value=true";
  
  // Add condition filter if specified
  if (condition && condition !== "all") {
    url += "&itemFilter(1).name=Condition";
    
    // Map condition values to eBay's condition IDs
    let conditionValue;
    switch (condition) {
      case "new":
        conditionValue = "1000"; // New
        break;
      case "used":
        conditionValue = "3000"; // Used
        break;
      case "unopened":
        conditionValue = "1500"; // New other
        break;
      case "mint":
        conditionValue = "1750"; // New with tags
        break;
      default:
        conditionValue = null;
    }
    
    if (conditionValue) {
      url += "&itemFilter(1).value=" + conditionValue;
    }
  }
  
  // Add price range if specified
  let filterIndex = condition && condition !== "all" ? 2 : 1;
  
  if (minPrice !== undefined) {
    url += `&itemFilter(${filterIndex}).name=MinPrice`;
    url += `&itemFilter(${filterIndex}).value=${minPrice}`;
    url += `&itemFilter(${filterIndex}).paramName=Currency`;
    url += `&itemFilter(${filterIndex}).paramValue=USD`;
    filterIndex++;
  }
  
  if (maxPrice !== undefined) {
    url += `&itemFilter(${filterIndex}).name=MaxPrice`;
    url += `&itemFilter(${filterIndex}).value=${maxPrice}`;
    url += `&itemFilter(${filterIndex}).paramName=Currency`;
    url += `&itemFilter(${filterIndex}).paramValue=USD`;
  }
  
  // Add sorting
  if (sort) {
    let sortOrder;
    switch (sort) {
      case "price-low":
        sortOrder = "PricePlusShippingLowest";
        break;
      case "price-high":
        sortOrder = "PricePlusShippingHighest";
        break;
      case "date-new":
        sortOrder = "EndTimeSoonest";
        break;
      case "date-old":
        sortOrder = "EndTimeNewest";
        break;
      default:
        sortOrder = "BestMatch";
    }
    url += "&sortOrder=" + sortOrder;
  }
  
  // Add pagination
  const entriesPerPage = 12;
  const pageNumber = page || 1;
  url += "&paginationInput.entriesPerPage=" + entriesPerPage;
  url += "&paginationInput.pageNumber=" + pageNumber;
  
  return url;
}

// Parse eBay API response
function parseEbayResponse(data: any): Listing[] {
  try {
    // Check if we have results
    const searchResult = data.findCompletedItemsResponse[0].searchResult[0];
    const count = parseInt(searchResult["@count"], 10);
    
    if (count === 0) {
      return [];
    }
    
    // Parse each item
    return searchResult.item.map((item: any) => {
      const id = item.itemId[0];
      const title = item.title[0];
      const condition = item.condition?.[0]?.conditionDisplayName?.[0] || "Unknown";
      
      // Get price information
      const price = parseFloat(item.sellingStatus[0].convertedCurrentPrice[0].__value__);
      
      // Get shipping cost if available
      let shipping: number | undefined = undefined;
      if (item.shippingInfo && item.shippingInfo[0].shippingServiceCost) {
        shipping = parseFloat(item.shippingInfo[0].shippingServiceCost[0].__value__);
      }
      
      // Get image URL if available
      const imageUrl = item.galleryURL?.[0] || undefined;
      
      // Get listing URL
      const listingUrl = item.viewItemURL[0];
      
      // Get sold date
      const soldDate = item.listingInfo[0].endTime[0];
      
      return {
        id,
        title,
        condition,
        price,
        shipping,
        imageUrl,
        listingUrl,
        soldDate
      };
    });
  } catch (error) {
    console.error("Error parsing eBay response:", error);
    return [];
  }
}

// Calculate market value statistics
function calculateMarketValue(listings: Listing[], query: string): MarketValue {
  if (!listings || listings.length === 0) {
    return {
      averagePrice: 0,
      medianPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      recommendedValue: 0,
      totalListings: 0,
      model: query,
    };
  }
  
  // Extract prices for calculations
  const prices = listings.map(listing => listing.price);
  
  // Sort prices for statistical calculations
  prices.sort((a, b) => a - b);
  
  // Calculate statistics
  const totalListings = prices.length;
  const minPrice = prices[0];
  const maxPrice = prices[totalListings - 1];
  
  // Calculate average
  const sum = prices.reduce((acc, price) => acc + price, 0);
  const averagePrice = sum / totalListings;
  
  // Calculate median
  let medianPrice: number;
  if (totalListings % 2 === 0) {
    // Even number of prices
    medianPrice = (prices[totalListings / 2 - 1] + prices[totalListings / 2]) / 2;
  } else {
    // Odd number of prices
    medianPrice = prices[Math.floor(totalListings / 2)];
  }
  
  // Remove outliers for recommended value (use interquartile range)
  const q1Index = Math.floor(totalListings * 0.25);
  const q3Index = Math.floor(totalListings * 0.75);
  const q1 = prices[q1Index];
  const q3 = prices[q3Index];
  const iqr = q3 - q1;
  
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  const filteredPrices = prices.filter(price => price >= lowerBound && price <= upperBound);
  
  // Calculate recommended value (weighted average of median and average)
  let recommendedValue: number;
  if (filteredPrices.length > 0) {
    const filteredSum = filteredPrices.reduce((acc, price) => acc + price, 0);
    const filteredAvg = filteredSum / filteredPrices.length;
    recommendedValue = filteredAvg * 0.6 + medianPrice * 0.4;
  } else {
    recommendedValue = medianPrice;
  }
  
  // Mock price change for now (would be calculated from historical data)
  const priceChange = (Math.random() * 10 - 5); // Random between -5% and +5%
  
  return {
    averagePrice,
    medianPrice,
    minPrice,
    maxPrice,
    recommendedValue,
    totalListings,
    priceChange,
    model: query,
  };
}

// Main function to search for HotWheels on eBay
export async function searchHotWheels(params: SearchParams): Promise<ListingsResponse> {
  try {
    if (!EBAY_API_KEY) {
      throw new Error("eBay API key is not configured. Please set the EBAY_API_KEY environment variable.");
    }
    
    const url = formatSearchUrl(params);
    
    // Fetch data from eBay API
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`eBay API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Parse response
    const listings = parseEbayResponse(data);
    
    // Calculate market value
    const marketValue = calculateMarketValue(listings, params.query);
    
    // Get pagination info
    const paginationOutput = data.findCompletedItemsResponse[0].paginationOutput[0];
    const totalPages = parseInt(paginationOutput.totalPages[0], 10);
    const totalListings = parseInt(paginationOutput.totalEntries[0], 10);
    const currentPage = parseInt(paginationOutput.pageNumber[0], 10);
    
    return {
      listings,
      totalListings,
      currentPage,
      totalPages,
      marketValue,
    };
  } catch (error) {
    console.error("Error searching HotWheels:", error);
    
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("An unknown error occurred while searching for HotWheels listings");
    }
  }
}

// Fallback function to generate mock data for testing (without eBay API key)
export function generateMockData(params: SearchParams): ListingsResponse {
  const totalListings = 47;
  const itemsPerPage = 12;
  const totalPages = Math.ceil(totalListings / itemsPerPage);
  const currentPage = params.page || 1;
  
  // Calculate how many items to show on the current page
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalListings);
  const itemCount = endIndex - startIndex;
  
  // Generate random listings
  const listings: Listing[] = [];
  const conditions = ["New", "Used", "Mint", "Unopened"];
  const colors = ["Red", "Blue", "Green", "Yellow", "Black", "Chrome", "White"];
  
  for (let i = 0; i < itemCount; i++) {
    const id = randomUUID();
    const color = colors[Math.floor(Math.random() * colors.length)];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    
    const price = 5 + Math.random() * 30; // Random price between $5-$35
    const shipping = Math.random() > 0.3 ? 2 + Math.random() * 6 : 0; // 70% chance of shipping cost
    
    // Generate a random date within the last 30 days
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 30));
    
    listings.push({
      id,
      title: `Hot Wheels ${params.query} ${color} Edition ${Math.floor(Math.random() * 2022 + 1990)}`,
      condition,
      price,
      shipping,
      imageUrl: undefined, // No images in mock data
      listingUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(params.query)}&LH_Sold=1&LH_Complete=1`,
      soldDate: date.toISOString(),
    });
  }
  
  // Calculate market value
  const marketValue = calculateMarketValue(listings, params.query);
  
  return {
    listings,
    totalListings,
    currentPage,
    totalPages,
    marketValue,
  };
}
