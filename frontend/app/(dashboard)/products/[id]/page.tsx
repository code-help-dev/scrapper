'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { productsApi } from '@/lib/api';
import { Product } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Flag, Tag } from 'lucide-react';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: product, isLoading } = useQuery<Product>({
    queryKey: ['product', id],
    queryFn: () => productsApi.get(id).then((r) => r.data),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm p-6">Loading…</div>;
  if (!product) return <div className="text-muted-foreground text-sm p-6">Product not found</div>;

  const basicSpecs = product.specifications.filter((s) => s.section === 'basic');
  const extendedSpecs = product.specifications.filter((s) => s.section === 'extended');

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl">
      {}
      <div className="flex items-start gap-4">
        <Link href="/products">
          <Button variant="ghost" size="icon" className="mt-1"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{product.productName}</h1>
            {product.isFlagged && <Badge variant="warning"><Flag className="h-3 w-3 mr-1" />Flagged</Badge>}
            <Badge variant={product.confidenceScore >= 70 ? 'success' : 'warning'}>
              {product.confidenceScore}% confidence
            </Badge>
            <Badge variant={product.extractionStatus === 'completed' ? 'success' : 'secondary'}>
              {product.extractionStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span>{product.category}{product.subCategory ? ` › ${product.subCategory}` : ''}</span>
            {product.price != null && (
              <span className="font-medium text-foreground">
                {product.currency} {product.price.toLocaleString()}
                {product.priceUnit && <span className="text-muted-foreground font-normal"> / {product.priceUnit}</span>}
                {product.moq && <span className="text-muted-foreground font-normal"> (MOQ: {product.moq})</span>}
              </span>
            )}
            <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-primary">
              Aajjo <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {}
        <div className="lg:col-span-2 space-y-4">

          {}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                Category
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="bg-muted/30">
                    <td className="px-4 py-2.5 font-medium w-36 text-muted-foreground">Category</td>
                    <td className="px-4 py-2.5">
                      {product.category
                        ? <span className="font-medium">{product.category}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-medium w-36 text-muted-foreground">Sub-Category</td>
                    <td className="px-4 py-2.5">
                      {product.subCategory
                        ? product.subCategory
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          {}
          {product.images.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Images</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-3 flex-wrap">
                  {product.images.map((img, i) => {
                    const href = img.storageUrl?.trim() || img.originalUrl?.trim() || '#';
                    const src = img.thumbnailUrl?.trim() || img.storageUrl?.trim() || img.originalUrl?.trim();
                    return (
                      <a key={i} href={href} target="_blank" rel="noopener noreferrer">
                        <div className={`relative w-20 h-20 rounded border overflow-hidden ${img.isFeatured ? 'ring-2 ring-primary' : ''}`}>
                          {src ? (
                            <Image
                              src={src}
                              alt={`Image ${i + 1}`}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted/40 text-[10px] text-muted-foreground">No img</div>
                          )}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {}
          {basicSpecs.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Specifications</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {basicSpecs.map((s, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
                        <td className="px-4 py-2 font-medium w-40 text-muted-foreground">{s.rawName}</td>
                        <td className="px-4 py-2">{s.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {}
          {extendedSpecs.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">More Specifications</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {extendedSpecs.map((s, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
                        <td className="px-4 py-2 font-medium w-40 text-muted-foreground">{s.rawName}</td>
                        <td className="px-4 py-2">{s.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {}
          {product.description && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Description</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{product.description}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Seller</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {product.seller?.sellerLogoUrl && (
                <div className="relative h-12 w-24 mb-2">
                  <Image src={product.seller.sellerLogoUrl} alt="Seller logo" fill className="object-contain" unoptimized />
                </div>
              )}
              <p className="font-medium">{product.seller?.sellerName || '—'}</p>
              {product.seller?.address && <p className="text-xs text-muted-foreground">{product.seller.address}</p>}
              {product.seller?.state && <p className="text-xs">{product.seller.state}, {product.seller.country}</p>}
              {product.seller?.contactDetails && <p className="text-xs">{product.seller.contactDetails}</p>}
              {product.seller?.aajjoProfileUrl && (
                <a href={product.seller.aajjoProfileUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1">
                  View on Aajjo <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </CardContent>
          </Card>

          {}
          {product.seller && (
            product.seller.gstNumber || product.seller.yearsEstablished || product.seller.businessType ||
            product.seller.numberOfEmployees || product.seller.turnover || product.seller.legalStatus
          ) && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Company Details</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: 'GST Number',          value: product.seller.gstNumber },
                      { label: 'Year of Establishment', value: product.seller.yearsEstablished?.toString() },
                      { label: 'Nature of Business',  value: product.seller.businessType },
                      { label: 'No. of Employees',    value: product.seller.numberOfEmployees },
                      { label: 'Turnover',             value: product.seller.turnover },
                      { label: 'Legal Status',         value: product.seller.legalStatus },
                    ]
                      .filter((r) => r.value)
                      .map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
                          <td className="px-4 py-2 font-medium text-muted-foreground">{r.label}</td>
                          <td className="px-4 py-2">{r.value}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {product.deliveryInformation && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Delivery</CardTitle></CardHeader>
              <CardContent className="text-sm">{product.deliveryInformation}</CardContent>
            </Card>
          )}
          {product.warrantyInformation && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Warranty</CardTitle></CardHeader>
              <CardContent className="text-sm">{product.warrantyInformation}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
