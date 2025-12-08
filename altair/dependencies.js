/**
 * Dependencies
 */
 
import express from 'express';
import cors from 'cors'
import { createServer } from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from 'config';
import { minify } from 'terser';
import CleanCSS from 'clean-css';

export { express, cors, createServer, fs, path, fileURLToPath, dotenv, config, minify, CleanCSS };