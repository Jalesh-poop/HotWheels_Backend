import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { searchHotWheels, generateMockData } from "./ebay/service";
import { searchParamsSchema } from "@shared/schema";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

export async function registerRoutes(app: Express): Promise<Server> {
  // API route to search for HotWheels listings
  app.get("/api/listings", async (req, res) => {
    try {
      // Parse and validate query parameters
      const params = searchParamsSchema.parse({
        query: req.query.query,
        condition: req.query.condition,
        minPrice: req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined,
        maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined,
        sort: req.query.sort,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      });
      
      // Check for eBay API key
      const EBAY_API_KEY = process.env.EBAY_API_KEY;
      let result;
      
      if (EBAY_API_KEY) {
        // Use real eBay API if key is available
        result = await searchHotWheels(params);
      } else {
        // Use mock data if no API key is available (for development)
        console.warn("No eBay API key found. Using mock data instead. Set EBAY_API_KEY environment variable for real data.");
        result = generateMockData(params);
      }
      
      return res.json(result);
    } catch (error) {
      console.error("Error searching listings:", error);
      
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ 
          message: "Invalid search parameters", 
          details: validationError.message
        });
      }
      
      return res.status(500).json({ 
        message: error instanceof Error ? error.message : "An unknown error occurred"
      });
    }
  });

  // Health check route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = createServer(app);

  return httpServer;
}
