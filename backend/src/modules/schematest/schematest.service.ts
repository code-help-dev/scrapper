import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class SchematestService {
  private readonly logger = new Logger(SchematestService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async dropDatabase(): Promise<{ message: string; droppedDb: string }> {
    const dbName = this.connection.db?.databaseName ?? 'aajjo_scraper';
    this.logger.warn(`Dropping database: ${dbName}`);
    await this.connection.dropDatabase();
    this.logger.warn(`Database dropped: ${dbName}`);
    return { message: 'Database dropped successfully', droppedDb: dbName };
  }
}
